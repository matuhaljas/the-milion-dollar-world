import assert from "node:assert/strict";
import { W, H, uvToCell, cellToLatLon, validateBlock, overlaps } from "./grid";

assert.deepEqual(uvToCell(0, 1), { x: 0, y: 0 });
assert.deepEqual(uvToCell(1, 0), { x: W - 1, y: H - 1 }); // edges clamp
assert.deepEqual(uvToCell(0.5, 0.5), { x: W / 2, y: H / 2 });
for (const [x, y] of [[0, 0], [123, 456], [W - 1, H - 1]]) {
  const { lat, lon } = cellToLatLon(x, y);
  assert.deepEqual(uvToCell((lon + 180) / 360, (lat + 90) / 180), { x, y });
}
assert.equal(validateBlock({ x: 0, y: 0, w: 5, h: 2 }), null);
assert.match(validateBlock({ x: 0, y: 0, w: 3, h: 3 })!, /Minimum/);
assert.match(validateBlock({ x: W - 4, y: 0, w: 5, h: 2 })!, /off the map/);
assert.match(validateBlock({ x: 0.5, y: 0, w: 5, h: 2 })!, /Invalid/);
assert.ok(overlaps({ x: 0, y: 0, w: 5, h: 2 }, { x: 4, y: 1, w: 5, h: 2 }));
assert.ok(!overlaps({ x: 0, y: 0, w: 5, h: 2 }, { x: 5, y: 0, w: 5, h: 2 })); // adjacent is fine
console.log("grid ok");
