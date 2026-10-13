"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import {
  N, TOTAL, ATLAS_W, ATLAS_H, FACES, type Block, type Cell, type Order, type Vec,
  vecToCell, cellCenter, cellIndex, atlasOrigin, faceToVec, vecToLatLon, latLonToVec, overlaps, pixelsToRGBA,
} from "@/lib/grid";
import BuyDialog from "./BuyDialog";

const OCEAN = [125, 151, 171]; // #7d97ab, muted
const LAND = [147, 169, 140]; // #93a98c, muted
const DEFAULT_W = 5;
const DEFAULT_H = 2;

const blockAt = (c: Cell): Block => ({
  face: c.face, x: Math.min(c.x, N - DEFAULT_W), y: Math.min(c.y, N - DEFAULT_H), w: DEFAULT_W, h: DEFAULT_H,
});

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
  int face = (ap.x >= ap.y && ap.x >= ap.z) ? (p.x > 0.0 ? 1 : 3) : (ap.y >= ap.z) ? (p.y > 0.0 ? 4 : 5) : (p.z > 0.0 ? 0 : 2);
  vec3 l = p / dot(p, FC[face]);
  vec2 ab = vec2(atan(dot(l, FR[face])), atan(dot(l, FU[face]))) / (PI / 4.0);
  vec2 cell = vec2(ab.x + 1.0, 1.0 - ab.y) * (0.5 * GN);
  vec2 atlas = vec2(float(face % 3), float(face / 3)) * GN + cell;
  float cpp = length(fwidth(p)) * GN / (PI * 0.5); // cells per screen pixel
  vec2 uv = vec2(atlas.x / AW, 1.0 - atlas.y / AH);
  diffuseColor.rgb = textureGrad(uAtlas, uv, vec2(cpp / AW, 0.0), vec2(0.0, cpp / AH)).rgb;

  vec2 edge = min(fract(cell), 1.0 - fract(cell)) / max(fwidth(cell), vec2(1e-6));
  float line = 1.0 - smoothstep(0.0, 1.0, min(edge.x, edge.y));
  float fade = smoothstep(8.0, 18.0, 1.0 / cpp); // grid only once cells are big on screen
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * fade * 0.3);
  if (inBlock(face, cell, uSel, uSelFace)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.83, 0.3), 0.75);
  else if (inBlock(face, cell, uHover, uHoverFace)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.5);
}`;

// Land/ocean per cell: rasterize the coastline once, then sample it at every cell center.
function buildBaseMap(land: GeoPermissibleObjects | null) {
  const MW = 2048, MH = 1024;
  const mask = document.createElement("canvas");
  mask.width = MW;
  mask.height = MH;
  const m = mask.getContext("2d", { willReadFrequently: true })!;
  if (land) {
    m.fillStyle = "#fff";
    m.beginPath();
    geoPath(geoEquirectangular().scale(MW / (2 * Math.PI)).translate([MW / 2, MH / 2]), m)(land);
    m.fill();
  }
  const isLand = m.getImageData(0, 0, MW, MH).data;
  const base = new ImageData(ATLAS_W, ATLAS_H);
  for (let face = 0; face < 6; face++) {
    const [ox, oy] = atlasOrigin(face);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const { lat, lon } = vecToLatLon(cellCenter({ face, x, y }));
        const mx = Math.min(MW - 1, Math.floor(((lon + 180) / 360) * MW));
        const my = Math.min(MH - 1, Math.floor(((90 - lat) / 180) * MH));
        const i = ((oy + y) * ATLAS_W + ox + x) * 4;
        base.data.set(isLand[(my * MW + mx) * 4] > 127 ? LAND : OCEAN, i);
        base.data[i + 3] = 255;
      }
  }
  return base;
}

let land: GeoPermissibleObjects | null = null; // loaded once per page

type Three = {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  uniforms: Record<"uSel" | "uHover", { value: THREE.Vector4 }> & Record<"uSelFace" | "uHoverFace", { value: number }>;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};

const toVector3 = (v: Vec, r = 1) => new THREE.Vector3(v[0] * r, v[1] * r, v[2] * r);

export default function Globe({ orders, paidId }: { orders: Order[]; paidId: string | null }) {
  const mount = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const three = useRef<Three>(null);
  const [isLandReady, setIsLandReady] = useState(!!land);
  const [selection, setSelection] = useState<Block | null>(null);
  const [owner, setOwner] = useState<Order | null>(null);
  const router = useRouter();

  // cell index → order index + 1, for O(1) hover/click lookup
  const cellOwner = useMemo(() => {
    const m = new Int32Array(TOTAL);
    orders.forEach((o, i) => {
      for (let y = o.y; y < o.y + o.h; y++) {
        const row = cellIndex({ face: o.face, x: o.x, y });
        m.fill(i + 1, row, row + o.w);
      }
    });
    return m;
  }, [orders]);

  // Pointer handlers live in the once-only three.js effect, so they read fresh data through this ref.
  const latestOrders = useRef({ orders, cellOwner });
  useEffect(() => {
    latestOrders.current = { orders, cellOwner };
  }, [orders, cellOwner]);

  useEffect(() => {
    const el = mount.current!;
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

    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; // crisp pixels when zoomed in

    const uniforms = {
      uAtlas: { value: texture },
      uSel: { value: new THREE.Vector4() }, uSelFace: { value: -1 },
      uHover: { value: new THREE.Vector4() }, uHoverFace: { value: -1 },
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
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
    scene.add(globe);

    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, {
      enableDamping: true, enablePan: false, minDistance: 1.05, maxDistance: 6, autoRotate: true, autoRotateSpeed: 0.4,
    });
    controls.addEventListener("start", () => (controls.autoRotate = false));
    controls.addEventListener("change", () => {
      const altitude = camera.position.length() - 1; // slow down near the surface
      controls.rotateSpeed = Math.min(1, altitude * 0.6);
      controls.zoomSpeed = Math.min(1, Math.max(0.1, altitude * 2));
    });

    three.current = { canvas, texture, uniforms, camera, controls };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(globe)[0]?.point.normalize();
      return hit ? vecToCell([hit.x, hit.y, hit.z]) : null;
    };
    const ownerAt = (c: Cell) => latestOrders.current.orders[latestOrders.current.cellOwner[cellIndex(c)] - 1];
    const setHover = (b: Block | null) => {
      uniforms.uHover.value.set(b?.x ?? 0, b?.y ?? 0, b?.w ?? 0, b?.h ?? 0);
      uniforms.uHoverFace.value = b?.face ?? -1;
    };

    const onMove = (e: PointerEvent) => {
      const tip = tooltip.current!;
      const c = e.pointerType === "touch" ? null : pick(e);
      if (!c) {
        setHover(null);
        tip.hidden = true;
        return;
      }
      const o = ownerAt(c);
      setHover(o ?? blockAt(c));
      tip.hidden = false;
      tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      tip.textContent = o ? `${o.name}${o.url ? ` · ${new URL(o.url).hostname}` : ""}` : "Free · click to buy";
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const isClick = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6; // not a drag
      down = null;
      const c = isClick && pick(e);
      if (!c) return;
      controls.autoRotate = false;
      const o = ownerAt(c);
      if (o) return setOwner(o);
      setOwner(null);
      setSelection(blockAt(c));
      dialog.current!.showModal();
    };
    const onLeave = () => {
      setHover(null);
      tooltip.current!.hidden = true;
    };
    const dom = renderer.domElement;
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);

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

    if (!land)
      import("world-atlas/land-50m.json").then(({ default: topo }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        land = feature(topo as any, (topo as any).objects.land) as GeoPermissibleObjects;
        setIsLandReady(true);
      });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      texture.dispose();
      el.removeChild(dom);
    };
  }, []);

  // Paint base map + every sold pixel into the atlas texture.
  // ponytail: all orders' pixels ship with the page (~6 MB at sell-out); serve a prebuilt atlas PNG if that bites.
  const baseMap = useRef<{ hasLand: boolean; image: ImageData }>(null);
  useEffect(() => {
    if (baseMap.current?.hasLand !== isLandReady) baseMap.current = { hasLand: isLandReady, image: buildBaseMap(land) };
    const { canvas, texture } = three.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(baseMap.current.image, 0, 0);
    for (const o of orders) {
      const [ox, oy] = atlasOrigin(o.face);
      ctx.putImageData(new ImageData(pixelsToRGBA(o.pixels), o.w, o.h), ox + o.x, oy + o.y);
    }
    texture.needsUpdate = true;
  }, [orders, isLandReady]);

  useEffect(() => {
    const { uSel, uSelFace } = three.current!.uniforms;
    uSel.value.set(selection?.x ?? 0, selection?.y ?? 0, selection?.w ?? 0, selection?.h ?? 0);
    uSelFace.value = selection?.face ?? -1;
  }, [selection]);

  // After Stripe: wait for the webhook to mark the order paid, then fly to it.
  const paidOrder = paidId ? orders.find((o) => o.id === paidId) : undefined;
  const tries = useRef(0);
  const [didGiveUp, setDidGiveUp] = useState(false);
  useEffect(() => {
    if (!paidId) return;
    if (paidOrder) {
      const { face, x, y, w, h } = paidOrder;
      const { camera, controls } = three.current!;
      camera.position.copy(toVector3(faceToVec(face, x + w / 2, y + h / 2), 1.15));
      controls.autoRotate = false;
      return;
    }
    if (tries.current++ >= 15) return setDidGiveUp(true);
    const t = setTimeout(() => router.refresh(), 2000);
    return () => clearTimeout(t);
  }, [paidId, paidOrder, orders, router]);

  const isTaken = !!selection && orders.some((o) => overlaps(o, selection));

  return (
    <>
      <div ref={mount} style={{ position: "absolute", inset: 0, touchAction: "none",
        background: "radial-gradient(circle at 50% 55%, #1b2a4a 0%, #0b1020 60%)" }} />
      <div ref={tooltip} hidden style={{ position: "fixed", left: 0, top: 0, pointerEvents: "none", padding: "4px 8px",
        borderRadius: 6, background: "#000c", fontSize: 13, whiteSpace: "nowrap" }} />

      {paidId && (
        <div role="status" style={{ position: "absolute", top: 140, left: "50%", transform: "translateX(-50%)",
          background: "#ffd34d", color: "#1a1400", padding: "8px 14px", borderRadius: 999, fontWeight: 600 }}>
          {paidOrder
            ? "🎉 Your pixels are live. Thank you!"
            : didGiveUp
              ? "Payment received. Your pixels will appear shortly; refresh in a minute."
              : "Payment received, placing your pixels…"}
        </div>
      )}

      {owner && (
        <div style={{ position: "absolute", left: "50%", bottom: 40, transform: "translateX(-50%)", display: "flex",
          gap: 12, alignItems: "center", background: "#151b2e", padding: "12px 16px", borderRadius: 12,
          maxWidth: "calc(100vw - 32px)", boxShadow: "0 10px 30px #0008" }}>
          <div style={{ minWidth: 0 }}>
            <b>{owner.name}</b> · {owner.w * owner.h} pixels
            {owner.url && (
              <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                <a href={owner.url} target="_blank" rel="nofollow noopener noreferrer ugc">{owner.url}</a>
              </div>
            )}
          </div>
          <button className="ghost" aria-label="Close" onClick={() => setOwner(null)}>✕</button>
        </div>
      )}

      <BuyDialog dialog={dialog} selection={selection} setSelection={setSelection} isTaken={isTaken} />
    </>
  );
}
