"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import {
  N, TOTAL, type Block, type Cell, type Order,
  vecToCell, cellIndex, atlasOrigin, faceToVec, overlaps, pixelsToRGBA,
} from "@/lib/grid";
import { createGlobeScene, setHighlight, toVector3, type GlobeScene } from "@/lib/globeScene";
import { buildBaseMap } from "@/lib/baseMap";
import BuyDialog from "./BuyDialog";

const DEFAULT_W = 5;
const DEFAULT_H = 2;

const blockAt = (c: Cell): Block => ({
  face: c.face, x: Math.min(c.x, N - DEFAULT_W), y: Math.min(c.y, N - DEFAULT_H), w: DEFAULT_W, h: DEFAULT_H,
});

let land: GeoPermissibleObjects | null = null; // loaded once per page

export default function Globe({ orders, paidId }: { orders: Order[]; paidId: string | null }) {
  const mount = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const three = useRef<GlobeScene>(null);
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
    const globeScene = createGlobeScene(mount.current!);
    three.current = globeScene;
    const { dom, camera, controls, globe, hover } = globeScene;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(globe)[0]?.point.normalize();
      return hit ? vecToCell([hit.x, hit.y, hit.z]) : null;
    };
    const ownerAt = (c: Cell) => latestOrders.current.orders[latestOrders.current.cellOwner[cellIndex(c)] - 1];
    const setHover = (b: Block | null) => setHighlight(hover, b);

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
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointerleave", onLeave);

    if (!land)
      import("world-atlas/land-50m.json").then(({ default: topo }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        land = feature(topo as any, (topo as any).objects.land) as GeoPermissibleObjects;
        setIsLandReady(true);
      });

    return globeScene.dispose;
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

  useEffect(() => setHighlight(three.current!.selection, selection), [selection]);

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
