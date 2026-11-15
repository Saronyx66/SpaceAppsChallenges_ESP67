import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { Ray, Vector3 } from "three";
import { TerrainSurface } from "./surface.ts";
import type { WholeMetadata } from "./whole";

// Tests use the real local numerical bundle, never synthetic terrain.
const bundle = gunzipSync(
  readFileSync(new URL("../../public/terrain/phlegra-full/whole.bin.gz", import.meta.url)),
);
const length = bundle.readUInt32LE(4),
  offset = 8 + length;
const meta: WholeMetadata = JSON.parse(bundle.toString("utf8", 8, offset));
const grid = new Float32Array(meta.gridBytes / 4);
for (let i = 0; i < grid.length; i++) grid[i] = bundle.readFloatLE(offset + i * 4);
const mask = new Uint8Array(
  bundle.buffer,
  bundle.byteOffset + offset + meta.gridBytes,
  meta.maskBytes,
);
const surface = new TerrainSurface(meta, grid, mask, 8);

test("rejects empty, nonnumeric, out-of-range and native NoData coordinates", () => {
  for (const p of [
    { x: "", y: "50" },
    { x: "NaN", y: "50" },
    { x: "Infinity", y: "50" },
    { x: "-1", y: "50" },
    { x: "101", y: "50" },
    { x: "0", y: "0" },
  ])
    assert.equal(surface.point(p), null);
});
test("existing base and destination are inside the real footprint", () => {
  assert.ok(surface.point({ x: "24.6", y: "68.2" }));
  assert.ok(surface.point({ x: "67.5", y: "34.8" }));
});
test("coordinate center uses projected metres and matches the rendered triangle", () => {
  const p = surface.point({ x: "50", y: "50" })!;
  assert.ok(p);
  assert.equal(p.x, 0);
  assert.equal(p.z, 0);
  const ray = new Ray(new Vector3(0, 1000, 0), new Vector3(0, -1, 0));
  assert.ok(surface.intersect(ray)!.distanceTo(p) < 1e-6);
});
test("selected mesh vertices retain their source float32 heights", () => {
  const col = 2560,
    row = 6400;
  const p = surface.point({
    x: String((col / (meta.width - 1)) * 100),
    y: String((row / (meta.height - 1)) * 100),
  })!;
  assert.ok(p);
  assert.ok(
    Math.abs(p.y + (meta.min + meta.max) / 2 - grid[(row / 4) * meta.gridWidth + col / 4]) < 1e-9,
  );
});
test("oblique ray picking and coordinate round trips agree with surface sampling", () => {
  let count = 0;
  for (let x = 10; x < 95; x += 10)
    for (let y = 10; y < 95; y += 10) {
      const p = surface.point({ x: String(x), y: String(y) });
      if (!p) continue;
      const origin = p.clone().add(new Vector3(250, 2000, -333));
      const hit = surface.intersect(new Ray(origin, p.clone().sub(origin).normalize()));
      assert.ok(hit && hit.distanceTo(p) < 1e-5);
      const roundtrip = surface.point(surface.coordinates(hit));
      assert.ok(roundtrip && roundtrip.distanceTo(hit) < 1e-4);
      count++;
    }
  assert.ok(count > 40);
});
test("a ray over native NoData does not hit the invisible support mesh", () => {
  const p = surface.vertex(0, 0);
  assert.equal(
    surface.intersect(new Ray(new Vector3(p.x, 1000, p.z), new Vector3(0, -1, 0))),
    null,
  );
});
