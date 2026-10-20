import { test } from "node:test";
import assert from "node:assert/strict";

const { GoogleStreetViewDepthLoader, NO_PLANE } = await import(
  "../src/GoogleStreetViewDepthLoader.js"
);
const { ErrorCodes } = await import("../src/errors.js");

// Encodes a depth map the way photometa does: header, per-pixel plane indices,
// then planes as normal xyz and distance, all little-endian, in web-safe base64.
function encodeDepth({ width, height, indices, planes }) {
  const offset = 8;
  const bytes = new Uint8Array(offset + width * height + planes.length * 16);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, offset);
  view.setUint16(1, planes.length, true);
  view.setUint16(3, width, true);
  view.setUint16(5, height, true);
  view.setUint16(7, offset, true);
  bytes.set(indices, offset);
  planes.forEach(({ n, d }, i) => {
    const at = offset + width * height + i * 16;
    n.forEach((c, j) => view.setFloat32(at + j * 4, c, true));
    view.setFloat32(at + 12, d, true);
  });
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stubDepth(raw) {
  const node = [];
  if (raw !== undefined) node[5] = [[null, null, null, null, null, [null, [null, null, raw]]]];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => ")]}'\n" + JSON.stringify([null, [node]]),
  });
}

// Top row is sky; the bottom row is a ground plane 2 m below, seen at 45° down.
const GROUND = {
  width: 4,
  height: 2,
  indices: [0, 0, 0, 0, 1, 1, 1, 1],
  planes: [
    { n: [0, 0, 0], d: 0 },
    { n: [0, 0, 1], d: 2 },
  ],
};

test("decodes a depth map into metres, with the sky at Infinity", async () => {
  stubDepth(encodeDepth(GROUND));
  const { width, height, depthMap } = await new GoogleStreetViewDepthLoader().load("pano");
  assert.equal(width, 4);
  assert.equal(height, 2);
  assert.ok(depthMap.slice(0, 4).every((d) => d === NO_PLANE));
  for (const d of depthMap.slice(4)) assert.ok(Math.abs(d - 2 * Math.SQRT2) < 1e-5, `got ${d}`);
});

test("a plane index past the end of the planes is BAD_METADATA, not a TypeError", async () => {
  stubDepth(encodeDepth({ ...GROUND, indices: [0, 0, 0, 0, 1, 1, 1, 7] }));
  await assert.rejects(
    new GoogleStreetViewDepthLoader().load("pano"),
    (e) => e.code === ErrorCodes.BAD_METADATA && /plane 7/.test(e.message)
  );
});

test("a panorama without depth says so", async () => {
  stubDepth(undefined);
  await assert.rejects(
    new GoogleStreetViewDepthLoader().load("pano"),
    (e) => e.code === ErrorCodes.BAD_METADATA && /No depth map/.test(e.message)
  );
});

test("fallbackToEmpty turns a missing depth map into an all-sky one", async () => {
  stubDepth(undefined);
  const { width, height, depthMap } = await new GoogleStreetViewDepthLoader({
    fallbackToEmpty: true,
  }).load("pano");
  assert.equal(depthMap.length, width * height);
  assert.ok(depthMap.every((d) => d === NO_PLANE));
});
