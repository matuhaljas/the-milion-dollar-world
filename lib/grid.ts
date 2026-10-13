export const W = 1440; // 0.25° cells
export const H = 720;
export const PRICE_CENTS = 100;
export const MIN_PIXELS = 10;

export type Block = { x: number; y: number; w: number; h: number };
export type Order = Block & { id: string; color: string; name: string; url: string | null };

// three.js sphere uv: u=0 at -180°, v=1 at north pole
export function uvToCell(u: number, v: number) {
  return {
    x: Math.min(W - 1, Math.max(0, Math.floor(u * W))),
    y: Math.min(H - 1, Math.max(0, Math.floor((1 - v) * H))),
  };
}

export function cellToLatLon(x: number, y: number) {
  return { lat: 90 - (y + 0.5) * (180 / H), lon: -180 + (x + 0.5) * (360 / W) };
}

// Returns an error message, or null if the block is buyable.
export function validateBlock({ x, y, w, h }: Block): string | null {
  if (![x, y, w, h].every(Number.isInteger)) return "Invalid block";
  if (w < 1 || h < 1 || w * h < MIN_PIXELS) return `Minimum is ${MIN_PIXELS} pixels`;
  if (x < 0 || y < 0 || x + w > W || y + h > H) return "Block runs off the map";
  return null;
}

export function overlaps(a: Block, b: Block) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
