import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { N, TOTAL, ATLAS_W, ATLAS_H, atlasOrigin, cellCenter, vecToLatLon } from "./grid";

const OCEAN = [125, 151, 171]; // #7d97ab, muted
const LAND = [147, 169, 140]; // #93a98c, muted
const MASK_W = 2048;
const MASK_H = 1024;

// Coastline rasterized to an equirectangular image: one byte per mask pixel, >127 = land.
function rasterizeLand(land: GeoPermissibleObjects | null) {
  const mask = document.createElement("canvas");
  mask.width = MASK_W;
  mask.height = MASK_H;
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  if (land) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    geoPath(geoEquirectangular().scale(MASK_W / (2 * Math.PI)).translate([MASK_W / 2, MASK_H / 2]), ctx)(land);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, MASK_W, MASK_H).data;
}

// Land/ocean color per cell, laid out like the globe's atlas texture.
export function buildBaseMap(land: GeoPermissibleObjects | null) {
  const mask = rasterizeLand(land);
  const base = new ImageData(ATLAS_W, ATLAS_H);
  for (let i = 0; i < TOTAL; i++) {
    const face = Math.floor(i / (N * N));
    const y = Math.floor(i / N) % N;
    const x = i % N;
    const { lat, lon } = vecToLatLon(cellCenter({ face, x, y }));
    const mx = Math.min(MASK_W - 1, Math.floor(((lon + 180) / 360) * MASK_W));
    const my = Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H));
    const [ox, oy] = atlasOrigin(face);
    const offset = ((oy + y) * ATLAS_W + ox + x) * 4;
    base.data.set(mask[(my * MASK_W + mx) * 4] > 127 ? LAND : OCEAN, offset);
    base.data[offset + 3] = 255;
  }
  return base;
}
