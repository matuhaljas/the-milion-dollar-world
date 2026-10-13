import assert from "node:assert/strict";
import {
  N, TOTAL, faceToVec, vecToCell, cellCenter, vecToLatLon, latLonToVec, validateBlock, overlaps,
  isPixelData, pixelsToRGBA, rgbaToPixels,
} from "./grid";

assert.equal(TOTAL, 998_784);

// Every sampled cell round-trips through 3D and back, on all six faces.
for (let face = 0; face < 6; face++)
  for (const [x, y] of [[0, 0], [N - 1, N - 1], [0, N - 1], [123, 321], [N / 2, N / 2]])
    assert.deepEqual(vecToCell(cellCenter({ face, x, y })), { face, x, y });

// lat/lon convention: lon 0 on face 0, north pole on face 4.
assert.equal(vecToCell(latLonToVec(0, 0)).face, 0);
assert.equal(vecToCell(latLonToVec(0, 90)).face, 1);
assert.equal(vecToCell(latLonToVec(89, 10)).face, 4);
assert.equal(vecToCell(latLonToVec(-89, 10)).face, 5);
const { lat, lon } = vecToLatLon(latLonToVec(59.4, 24.7));
assert.ok(Math.abs(lat - 59.4) < 1e-9 && Math.abs(lon - 24.7) < 1e-9);

// The point of the cube-sphere: biggest cell is < 1.5× the smallest (lat/lon grid at 0.25° was ~460×).
const area = (f: number, x: number, y: number) => {
  const [a, b, c] = [faceToVec(f, x, y), faceToVec(f, x + 1, y), faceToVec(f, x, y + 1)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
};
let min = Infinity, max = 0;
for (let x = 0; x < N; x += 7) for (let y = 0; y < N; y += 7) {
  const s = area(4, x, y);
  min = Math.min(min, s);
  max = Math.max(max, s);
}
assert.ok(max / min < 1.5, `cell area ratio ${max / min}`);

assert.equal(validateBlock({ face: 0, x: 0, y: 0, w: 5, h: 2 }), null);
assert.match(validateBlock({ face: 0, x: 0, y: 0, w: 3, h: 3 })!, /Minimum/);
assert.match(validateBlock({ face: 0, x: N - 4, y: 0, w: 5, h: 2 })!, /edge/);
assert.match(validateBlock({ face: 0, x: 0, y: 0, w: 101, h: 1 })!, /Max/);
assert.match(validateBlock({ face: 6, x: 0, y: 0, w: 5, h: 2 })!, /Invalid/);
assert.ok(overlaps({ face: 1, x: 0, y: 0, w: 5, h: 2 }, { face: 1, x: 4, y: 1, w: 5, h: 2 }));
assert.ok(!overlaps({ face: 1, x: 0, y: 0, w: 5, h: 2 }, { face: 2, x: 0, y: 0, w: 5, h: 2 })); // other face
assert.ok(!overlaps({ face: 1, x: 0, y: 0, w: 5, h: 2 }, { face: 1, x: 5, y: 0, w: 5, h: 2 })); // adjacent

const art = "ff0000".repeat(5) + "00ff7f".repeat(5);
assert.ok(isPixelData(art, 5, 2));
assert.ok(!isPixelData(art, 5, 3));
assert.ok(!isPixelData(art.replace("f", "g"), 5, 2));
assert.equal(rgbaToPixels(pixelsToRGBA(art)), art);
console.log(`grid ok (cell area ratio ${(max / min).toFixed(2)})`);
