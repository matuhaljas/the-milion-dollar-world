import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { N, ATLAS_W, ATLAS_H, FACES, type Block, type Vec, latLonToVec } from "./grid";

const glslVecs = (key: "c" | "r" | "u") => `vec3[6](${FACES.map((f) => `vec3(${f[key].join(".0,")}.0)`).join(",")})`;

// Each fragment works out its own cube-sphere cell, so cell edges are exact and match picking in lib/grid.ts.
const FRAGMENT_HEAD = `
#define GN ${N}.0
#define AW ${ATLAS_W}.0
#define AH ${ATLAS_H}.0
const vec3 FC[6] = ${glslVecs("c")};
const vec3 FR[6] = ${glslVecs("r")};
const vec3 FU[6] = ${glslVecs("u")};
uniform sampler2D uAtlas;
uniform vec4 uSel; uniform float uSelFace;
uniform vec4 uHover; uniform float uHoverFace;
varying vec3 vObjPos;
bool inBlock(int face, vec2 cell, vec4 r, float rFace) {
  return r.z > 0.0 && float(face) == rFace && cell.x >= r.x && cell.x < r.x + r.z && cell.y >= r.y && cell.y < r.y + r.w;
}`;

const FRAGMENT_BODY = `
{
  vec3 p = normalize(vObjPos);
  vec3 ap = abs(p);
  int face; // same tie-breaking as faceOf() in lib/grid.ts
  if (ap.x >= ap.y && ap.x >= ap.z) face = p.x > 0.0 ? 1 : 3;
  else if (ap.y >= ap.z) face = p.y > 0.0 ? 4 : 5;
  else face = p.z > 0.0 ? 0 : 2;
  vec3 l = p / dot(p, FC[face]);
  vec2 ab = vec2(atan(dot(l, FR[face])), atan(dot(l, FU[face]))) / (PI / 4.0);
  vec2 cell = vec2(ab.x + 1.0, 1.0 - ab.y) * (0.5 * GN);
  vec2 atlas = vec2(float(face % 3), float(face / 3)) * GN + cell;
  float cellsPerPixel = length(fwidth(p)) * GN / (PI * 0.5);
  vec2 uv = vec2(atlas.x / AW, 1.0 - atlas.y / AH);
  diffuseColor.rgb = textureGrad(uAtlas, uv, vec2(cellsPerPixel / AW, 0.0), vec2(0.0, cellsPerPixel / AH)).rgb;

  vec2 edge = min(fract(cell), 1.0 - fract(cell)) / max(fwidth(cell), vec2(1e-6));
  float line = 1.0 - smoothstep(0.0, 1.0, min(edge.x, edge.y));
  float fade = smoothstep(8.0, 18.0, 1.0 / cellsPerPixel); // grid only once cells are big on screen
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * fade * 0.3);
  if (inBlock(face, cell, uSel, uSelFace)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.83, 0.3), 0.75);
  else if (inBlock(face, cell, uHover, uHoverFace)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.5);
}`;

// A block outlined on the globe (the selection or the hovered block).
export type Highlight = { rect: { value: THREE.Vector4 }; face: { value: number } };

export function setHighlight(highlight: Highlight, block: Block | null) {
  highlight.rect.value.set(block?.x ?? 0, block?.y ?? 0, block?.w ?? 0, block?.h ?? 0);
  highlight.face.value = block?.face ?? -1;
}

export const toVector3 = (v: Vec, r = 1) => new THREE.Vector3(v[0] * r, v[1] * r, v[2] * r);

function createAtlasTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; // crisp pixels when zoomed in
  return { canvas, texture };
}

function createGlobeMaterial(texture: THREE.Texture, selection: Highlight, hover: Highlight) {
  const uniforms = {
    uAtlas: { value: texture },
    uSel: selection.rect, uSelFace: selection.face,
    uHover: hover.rect, uHoverFace: hover.face,
  };
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <map_fragment>", FRAGMENT_BODY);
  };
  return material;
}

function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
  const controls = new OrbitControls(camera, dom);
  Object.assign(controls, {
    enableDamping: true,
    enablePan: false,
    minDistance: 1.05,
    maxDistance: 6,
    autoRotate: true,
    autoRotateSpeed: 0.4,
  });
  controls.addEventListener("start", () => (controls.autoRotate = false));
  controls.addEventListener("change", () => {
    const altitude = camera.position.length() - 1; // slow down near the surface
    controls.rotateSpeed = Math.min(1, altitude * 0.6);
    controls.zoomSpeed = Math.min(1, Math.max(0.1, altitude * 2));
  });
  return controls;
}

// Renderer, camera, lights, globe mesh and controls, mounted into `el` and rendering until dispose().
export function createGlobeScene(el: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.copy(toVector3(latLonToVec(40, 15), 3.4));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.3);
  sun.position.set(-1, 1, 2);
  camera.add(sun); // light follows the viewer
  scene.add(camera);

  const { canvas, texture } = createAtlasTexture();
  const newHighlight = (): Highlight => ({ rect: { value: new THREE.Vector4() }, face: { value: -1 } });
  const selection = newHighlight();
  const hover = newHighlight();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), createGlobeMaterial(texture, selection, hover));
  scene.add(globe);
  const controls = createControls(camera, renderer.domElement);

  const ro = new ResizeObserver(() => {
    renderer.setSize(el.clientWidth, el.clientHeight);
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
  });
  ro.observe(el);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  const dispose = () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    texture.dispose();
    el.removeChild(renderer.domElement);
  };
  return { dom: renderer.domElement, camera, controls, globe, canvas, texture, selection, hover, dispose };
}

export type GlobeScene = ReturnType<typeof createGlobeScene>;
