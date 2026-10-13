// The globe is a cube with N×N cells per face, puffed into a sphere (equiangular cube-sphere).
// Unlike a lat/lon grid, cells stay within ~1.4× of each other in area, so there are no tiny polar slivers.
export const N = 408;
export const TOTAL = 6 * N * N; // 998,784 pixels
export const PRICE_CENTS = 100;
export const MIN_PIXELS = 10;
export const MAX_SIDE = 100;
export const ATLAS_W = 3 * N; // faces laid out 3×2 in one texture
export const ATLAS_H = 2 * N;

export type Vec = [number, number, number];
export type Cell = { face: number; x: number; y: number };
export type Block = Cell & { w: number; h: number };
// pixels: w*h colors as 6-char hex, row-major, no '#'
export type Order = Block & { id: string; name: string; url: string | null; pixels: string };

// Each face seen from outside: center, right (+x) and up (-y). Equator faces have north up, east right.
export const FACES: { c: Vec; r: Vec; u: Vec }[] = [
  { c: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, // lon 0
  { c: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] }, // lon 90°E
  { c: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] }, // lon 180
  { c: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] }, // lon 90°W
  { c: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] }, // north pole
  { c: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] }, // south pole
];

const Q = Math.PI / 4;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Same tie-breaking as the globe shader.
export function faceOf([x, y, z]: Vec) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? 1 : 3;
  if (ay >= az) return y > 0 ? 4 : 5;
  return z > 0 ? 0 : 2;
}

// Continuous face coords: cell (x, y) spans [x, x+1) × [y, y+1).
export function faceToVec(face: number, fx: number, fy: number): Vec {
  const { c, r, u } = FACES[face];
  const s = Math.tan(((fx / N) * 2 - 1) * Q);
  const t = Math.tan((1 - (fy / N) * 2) * Q);
  const v: Vec = [c[0] + s * r[0] + t * u[0], c[1] + s * r[1] + t * u[1], c[2] + s * r[2] + t * u[2]];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vecToCell(v: Vec): Cell {
  const face = faceOf(v);
  const { c, r, u } = FACES[face];
  const d = dot(v, c);
  const a = Math.atan(dot(v, r) / d) / Q; // -1..1, left → right
  const b = Math.atan(dot(v, u) / d) / Q; // -1..1, bottom → top
  const clamp = (n: number) => Math.min(N - 1, Math.max(0, Math.floor(n)));
  return { face, x: clamp(((a + 1) / 2) * N), y: clamp(((1 - b) / 2) * N) };
}

export const cellCenter = (c: Cell) => faceToVec(c.face, c.x + 0.5, c.y + 0.5);
export const cellIndex = (c: Cell) => (c.face * N + c.y) * N + c.x;
export const atlasOrigin = (face: number) => [(face % 3) * N, Math.floor(face / 3) * N] as const;

const DEG = 180 / Math.PI;
export const vecToLatLon = ([x, y, z]: Vec) => ({ lat: Math.asin(y) * DEG, lon: Math.atan2(x, z) * DEG });
export function latLonToVec(lat: number, lon: number): Vec {
  const la = lat / DEG, lo = lon / DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

// Returns an error message, or null if the block is buyable.
export function validateBlock({ face, x, y, w, h }: Block): string | null {
  if (![face, x, y, w, h].every(Number.isInteger) || face < 0 || face > 5) return "Invalid block";
  if (w < 1 || h < 1 || w * h < MIN_PIXELS) return `Minimum is ${MIN_PIXELS} pixels`;
  if (w > MAX_SIDE || h > MAX_SIDE) return `Max ${MAX_SIDE}×${MAX_SIDE} per purchase`;
  if (x < 0 || y < 0 || x + w > N || y + h > N) return "Block runs off the edge of this map tile";
  return null;
}

export const overlaps = (a: Block, b: Block) =>
  a.face === b.face && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const isPixelData = (pixels: string, w: number, h: number) =>
  pixels.length === 6 * w * h && /^[0-9a-f]*$/.test(pixels);

export function pixelsToRGBA(pixels: string) {
  const rgba = new Uint8ClampedArray((pixels.length / 6) * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 6, j += 4) {
    rgba[j] = parseInt(pixels.slice(i, i + 2), 16);
    rgba[j + 1] = parseInt(pixels.slice(i + 2, i + 4), 16);
    rgba[j + 2] = parseInt(pixels.slice(i + 4, i + 6), 16);
    rgba[j + 3] = 255;
  }
  return rgba;
}

export function rgbaToPixels(rgba: Uint8ClampedArray) {
  let out = "";
  for (let j = 0; j < rgba.length; j += 4)
    for (let k = 0; k < 3; k++) out += rgba[j + k].toString(16).padStart(2, "0");
  return out;
}
