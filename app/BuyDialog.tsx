"use client";
import { useActionState, useEffect, useRef, useState, type RefObject } from "react";
import { N, PRICE_CENTS, MIN_PIXELS, MAX_SIDE, type Block, cellCenter, vecToLatLon, rgbaToPixels } from "@/lib/grid";
import { createCheckout } from "./actions";

const euro = (pixels: number) => `€${((pixels * PRICE_CENTS) / 100).toLocaleString("en")}`;

type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  selection: Block | null;
  setSelection: (b: Block | null) => void;
  isTaken: boolean;
};

export default function BuyDialog({ dialog, selection, setSelection, isTaken }: Props) {
  const [error, buy, isBuying] = useActionState(createCheckout, null);
  const [brush, setBrush] = useState("#e63946");
  const art = useRef<HTMLCanvasElement | null>(null); // the w×h picture; survives resizes and reopening
  const view = useRef<HTMLCanvasElement>(null);

  const redraw = () => {
    const v = view.current;
    if (!v || !art.current) return;
    v.width = art.current.width;
    v.height = art.current.height;
    v.getContext("2d")!.drawImage(art.current, 0, 0);
  };

  // Resize the picture with the block, keeping what's already painted.
  const isOpen = !!selection;
  useEffect(() => {
    if (!selection) return;
    const { w, h } = selection;
    const old = art.current;
    if (old?.width !== w || old?.height !== h) {
      const next = document.createElement("canvas");
      next.width = w;
      next.height = h;
      const ctx = next.getContext("2d")!;
      ctx.fillStyle = brush;
      ctx.fillRect(0, 0, w, h);
      if (old) ctx.drawImage(old, 0, 0);
      art.current = next;
    }
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selection?.w, selection?.h]);

  const artCtx = () => art.current!.getContext("2d", { willReadFrequently: true })!;

  // Paint from the last cell to this one, so fast strokes don't leave gaps.
  const lastCell = useRef<{ x: number; y: number } | null>(null);
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * art.current!.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * art.current!.height);
    const from = lastCell.current ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    const ctx = artCtx();
    ctx.fillStyle = brush;
    for (let i = 0; i <= steps; i++)
      ctx.fillRect(Math.round(from.x + ((x - from.x) * i) / steps), Math.round(from.y + ((y - from.y) * i) / steps), 1, 1);
    lastCell.current = { x, y };
    redraw();
  };

  const fillAll = () => {
    const ctx = artCtx();
    ctx.fillStyle = brush;
    ctx.fillRect(0, 0, art.current!.width, art.current!.height);
    redraw();
  };

  // Shrink an uploaded image onto the block (cover-crop), like the original site's block images.
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const img = await createImageBitmap(file);
    const { width: w, height: h } = art.current!;
    const scale = Math.max(w / img.width, h / img.height);
    const ctx = artCtx();
    ctx.fillStyle = brush;
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    redraw();
  };

  const submit = (form: FormData) => {
    const { width: w, height: h } = art.current!;
    form.set("pixels", rgbaToPixels(artCtx().getImageData(0, 0, w, h).data));
    buy(form);
  };

  const resize = (key: "w" | "h", value: string) => {
    const n = parseInt(value, 10);
    if (!selection || !(n >= 1)) return;
    const room = key === "w" ? N - selection.x : N - selection.y;
    setSelection({ ...selection, [key]: Math.min(n, MAX_SIDE, room) });
  };

  const pixels = selection ? selection.w * selection.h : 0;
  const where = selection && vecToLatLon(cellCenter(selection));
  const problem = isTaken
    ? "Part of this block is already sold. Try another spot."
    : pixels < MIN_PIXELS
      ? `Minimum is ${MIN_PIXELS} pixels.`
      : error;
  const scale = selection ? Math.min(340 / selection.w, 220 / selection.h) : 1;

  return (
    <dialog ref={dialog} onClose={() => setSelection(null)}>
      {selection && (
        <form action={submit}>
          <h2 style={{ margin: "0 0 2px" }}>Buy {pixels} pixels</h2>
          <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
            Near {where!.lat.toFixed(2)}°, {where!.lon.toFixed(2)}° · highlighted in yellow on the globe
          </p>
          <input type="hidden" name="face" value={selection.face} />
          <input type="hidden" name="x" value={selection.x} />
          <input type="hidden" name="y" value={selection.y} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label htmlFor="w">Width</label>
              <input id="w" name="w" type="number" min={1} max={Math.min(MAX_SIDE, N - selection.x)} required
                defaultValue={selection.w} onChange={(e) => resize("w", e.target.value)} />
            </div>
            <div>
              <label htmlFor="h">Height</label>
              <input id="h" name="h" type="number" min={1} max={Math.min(MAX_SIDE, N - selection.y)} required
                defaultValue={selection.h} onChange={(e) => resize("h", e.target.value)} />
            </div>
          </div>

          <label htmlFor="brush">Paint your pixels: click or drag</label>
          <canvas
            ref={view}
            aria-label="Pixel editor"
            style={{ display: "block", margin: "6px auto 0", width: selection.w * scale, maxWidth: "100%",
              aspectRatio: `${selection.w} / ${selection.h}`, imageRendering: "pixelated", touchAction: "none",
              cursor: "crosshair", outline: "1px solid #ffffff33" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              lastCell.current = null;
              paint(e);
            }}
            onPointerMove={(e) => e.buttons && paint(e)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <input id="brush" type="color" value={brush} onChange={(e) => setBrush(e.target.value)}
              style={{ width: 44, flex: "none" }} aria-label="Brush color" />
            <button type="button" className="ghost" onClick={fillAll}>Fill all</button>
            <label className="ghost-button" style={{ margin: 0 }}>
              Upload image
              <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>

          <label htmlFor="name">Your name (shown on hover)</label>
          <input id="name" name="name" required maxLength={40} autoComplete="nickname" />
          <label htmlFor="url">Link (optional)</label>
          <input id="url" name="url" type="url" pattern="https://.*" maxLength={200} placeholder="https://" />
          {problem && <p role="alert" style={{ color: "#ff8a80", margin: "10px 0 0" }}>{problem}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="ghost" onClick={() => dialog.current!.close()}>Cancel</button>
            <button disabled={isBuying || isTaken || pixels < MIN_PIXELS}>
              {isBuying ? "Opening checkout…" : `Pay ${euro(pixels)}`}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
