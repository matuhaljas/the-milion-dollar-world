"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import { W, H, PRICE_CENTS, MIN_PIXELS, type Block, type Order, uvToCell, cellToLatLon, overlaps } from "@/lib/grid";
import { createCheckout } from "./actions";

const OCEAN = "#7d97ab";
const LAND = "#93a98c";
const DEFAULT_W = 5;
const DEFAULT_H = 2;

// Matches three.js SphereGeometry: u=0 → lon -180 at -X, north pole at +Y.
function lonLatToVec(lat: number, lon: number, r: number) {
  const phi = ((lon + 180) / 180) * Math.PI;
  const la = (lat * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(phi) * Math.cos(la) * r);
}

const blockAt = (c: { x: number; y: number }, w = DEFAULT_W, h = DEFAULT_H): Block => ({
  x: Math.min(c.x, W - w), y: Math.min(c.y, H - h), w, h,
});

const euro = (pixels: number) => `€${((pixels * PRICE_CENTS) / 100).toLocaleString("en")}`;

let land: GeoPermissibleObjects | null = null; // loaded once per page

type Three = {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  uniforms: { uSel: { value: THREE.Vector4 }; uHover: { value: THREE.Vector4 } };
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};

export default function Globe({ orders, paidId }: { orders: Order[]; paidId: string | null }) {
  const mount = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const three = useRef<Three>(null);
  const [landReady, setLandReady] = useState(!!land);
  const [sel, setSel] = useState<Block | null>(null);
  const [owner, setOwner] = useState<Order | null>(null);
  const [error, buy, buying] = useActionState(createCheckout, null);
  const router = useRouter();

  // cell index → order index + 1, for O(1) hover/click lookup
  const cellOwner = useMemo(() => {
    const m = new Int32Array(W * H);
    orders.forEach((o, i) => {
      for (let y = o.y; y < o.y + o.h; y++) m.fill(i + 1, y * W + o.x, y * W + o.x + o.w);
    });
    return m;
  }, [orders]);

  // Pointer handlers live in the once-only three.js effect, so they read fresh data through this ref.
  const live = useRef({ orders, cellOwner });
  useEffect(() => {
    live.current = { orders, cellOwner };
  }, [orders, cellOwner]);

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.copy(lonLatToVec(40, 15, 3.4));
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.3);
    sun.position.set(-1, 1, 2);
    camera.add(sun); // light follows the viewer
    scene.add(camera);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; // crisp pixels when zoomed in
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const uniforms = { uSel: { value: new THREE.Vector4() }, uHover: { value: new THREE.Vector4() } };
    const material = new THREE.MeshLambertMaterial({ map: texture });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
uniform vec4 uSel;
uniform vec4 uHover;
bool inRect(vec2 c, vec4 r) { return r.z > 0.0 && c.x >= r.x && c.x < r.x + r.z && c.y >= r.y && c.y < r.y + r.w; }`)
        .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec2 cell = vec2(vMapUv.x * ${W}.0, (1.0 - vMapUv.y) * ${H}.0);
  vec2 px = fwidth(cell);
  vec2 edge = min(fract(cell), 1.0 - fract(cell)) / px;
  float line = 1.0 - smoothstep(0.0, 1.0, min(edge.x, edge.y));
  float fade = smoothstep(8.0, 18.0, 1.0 / max(px.x, px.y)); // grid only once cells are big on screen
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * fade * 0.3);
  if (inRect(cell, uSel)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.83, 0.3), 0.75);
  else if (inRect(cell, uHover)) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.5);
}`);
    };
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), material);
    scene.add(globe);

    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 1.05, maxDistance: 6, autoRotate: true, autoRotateSpeed: 0.4 });
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
      const uv = raycaster.intersectObject(globe)[0]?.uv;
      return uv ? uvToCell(uv.x, uv.y) : null;
    };
    const ownerAt = (c: { x: number; y: number }) => live.current.orders[live.current.cellOwner[c.y * W + c.x] - 1];

    const onMove = (e: PointerEvent) => {
      const t = tip.current!;
      const c = e.pointerType === "touch" ? null : pick(e);
      if (!c) {
        uniforms.uHover.value.set(0, 0, 0, 0);
        t.hidden = true;
        return;
      }
      const o = ownerAt(c);
      const b = o ?? blockAt(c);
      uniforms.uHover.value.set(b.x, b.y, b.w, b.h);
      t.hidden = false;
      t.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      t.textContent = o ? `${o.name}${o.url ? ` · ${new URL(o.url).hostname}` : ""}` : "Free · click to buy";
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
      setSel(blockAt(c));
      dialog.current!.showModal();
    };
    const onLeave = () => {
      uniforms.uHover.value.set(0, 0, 0, 0);
      tip.current!.hidden = true;
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
        setLandReady(true);
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

  // Paint base map + sold blocks into the texture.
  useEffect(() => {
    const { canvas, texture } = three.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, W, H);
    if (land) {
      ctx.fillStyle = LAND;
      ctx.beginPath();
      geoPath(geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]), ctx)(land);
      ctx.fill();
    }
    for (const o of orders) {
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    texture.needsUpdate = true;
  }, [orders, landReady]);

  useEffect(() => {
    three.current!.uniforms.uSel.value.set(sel?.x ?? 0, sel?.y ?? 0, sel?.w ?? 0, sel?.h ?? 0);
  }, [sel]);

  // After Stripe: wait for the webhook to mark the order paid, then fly to it.
  const paidOrder = paidId ? orders.find((o) => o.id === paidId) : undefined;
  const tries = useRef(0);
  useEffect(() => {
    if (!paidId) return;
    if (paidOrder) {
      const { lat, lon } = cellToLatLon(paidOrder.x + paidOrder.w / 2, paidOrder.y + paidOrder.h / 2);
      const { camera, controls } = three.current!;
      camera.position.copy(lonLatToVec(lat, lon, 1.15));
      controls.autoRotate = false;
      return;
    }
    if (tries.current++ < 15) {
      const t = setTimeout(() => router.refresh(), 2000);
      return () => clearTimeout(t);
    }
  }, [paidId, paidOrder, orders, router]);

  const pixels = sel ? sel.w * sel.h : 0;
  const taken = !!sel && orders.some((o) => overlaps(o, sel));
  const where = sel && cellToLatLon(sel.x, sel.y);
  const resize = (key: "w" | "h", value: string) => {
    const n = parseInt(value, 10);
    if (sel && n >= 1) setSel({ ...sel, [key]: Math.min(n, key === "w" ? W - sel.x : H - sel.y) });
  };

  return (
    <>
      <div ref={mount} style={{ position: "absolute", inset: 0, touchAction: "none",
        background: "radial-gradient(circle at 50% 55%, #1b2a4a 0%, #0b1020 60%)" }} />
      <div ref={tip} hidden style={{ position: "fixed", left: 0, top: 0, pointerEvents: "none", padding: "4px 8px",
        borderRadius: 6, background: "#000c", fontSize: 13, whiteSpace: "nowrap" }} />

      {paidId && (
        <div role="status" style={{ position: "absolute", top: 140, left: "50%", transform: "translateX(-50%)",
          background: "#ffd34d", color: "#1a1400", padding: "8px 14px", borderRadius: 999, fontWeight: 600 }}>
          {paidOrder ? "🎉 Your pixels are live. Thank you!" : tries.current > 15 ? "Payment received. Your pixels will appear shortly; refresh in a minute." : "Payment received, placing your pixels…"}
        </div>
      )}

      {owner && (
        <div style={{ position: "absolute", left: "50%", bottom: 40, transform: "translateX(-50%)", display: "flex",
          gap: 12, alignItems: "center", background: "#151b2e", padding: "12px 16px", borderRadius: 12,
          maxWidth: "calc(100vw - 32px)", boxShadow: "0 10px 30px #0008" }}>
          <span style={{ width: 22, height: 22, borderRadius: 4, background: owner.color, flex: "none" }} />
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

      <dialog ref={dialog} onClose={() => setSel(null)}>
        {sel && (
          <form action={buy}>
            <h2 style={{ margin: "0 0 2px" }}>Buy {pixels} pixels</h2>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
              Near {where!.lat.toFixed(2)}°, {where!.lon.toFixed(2)}° · highlighted in yellow on the globe
            </p>
            <input type="hidden" name="x" value={sel.x} />
            <input type="hidden" name="y" value={sel.y} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label htmlFor="w">Width (cells)</label>
                <input id="w" name="w" type="number" min={1} max={W - sel.x} required defaultValue={sel.w} onChange={(e) => resize("w", e.target.value)} />
              </div>
              <div>
                <label htmlFor="h">Height (cells)</label>
                <input id="h" name="h" type="number" min={1} max={H - sel.y} required defaultValue={sel.h} onChange={(e) => resize("h", e.target.value)} />
              </div>
            </div>
            <label htmlFor="color">Color</label>
            <input id="color" name="color" type="color" defaultValue="#e63946" />
            <label htmlFor="name">Your name (shown on hover)</label>
            <input id="name" name="name" required maxLength={40} autoComplete="nickname" />
            <label htmlFor="url">Link (optional)</label>
            <input id="url" name="url" type="url" pattern="https://.*" maxLength={200} placeholder="https://" />
            {(taken || pixels < MIN_PIXELS || error) && (
              <p role="alert" style={{ color: "#ff8a80", margin: "10px 0 0" }}>
                {taken ? "Part of this block is already sold. Try another spot." : pixels < MIN_PIXELS ? `Minimum is ${MIN_PIXELS} pixels.` : error}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="ghost" onClick={() => dialog.current!.close()}>Cancel</button>
              <button disabled={buying || taken || pixels < MIN_PIXELS}>
                {buying ? "Opening checkout…" : `Pay ${euro(pixels)}`}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
