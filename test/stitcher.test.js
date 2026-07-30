import { test } from "node:test";
import assert from "node:assert/strict";

import { installDOM, loads, FakeCanvas } from "./dom-stub.js";

installDOM();

const { Stitcher } = await import("../src/Stitcher.js");
const { ErrorCodes } = await import("../src/errors.js");

function tile(url, x = 0, y = 0, w = 512, h = 512) {
  return { url, x, y, w, h };
}

test("process() on an empty queue resolves instead of hanging", async () => {
  const s = new Stitcher(new FakeCanvas());
  const result = await Promise.race([
    s.process(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 500)),
  ]);
  assert.equal(result, true);
});

test("empty queue reports 100% rather than NaN", async () => {
  const s = new Stitcher(new FakeCanvas());
  const seen = [];
  s.onProgress = (p) => seen.push(p);
  await s.process();
  assert.ok(seen.length > 0, "onProgress should be called");
  assert.ok(
    seen.every((p) => Number.isFinite(p)),
    `progress values must be finite, got ${seen}`
  );
});

test("a failing tile rejects with NO_IMAGE", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/ok-1"));
  s.addTileTask(tile("https://example.com/fail-1"));

  await assert.rejects(s.process(), (e) => {
    assert.equal(e.code, ErrorCodes.NO_IMAGE);
    return true;
  });
});

test("a failing run leaves no queued work behind", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/fail-1"));
  s.addTileTask(tile("https://example.com/ok-1"));

  await s.process().catch(() => {});
  assert.equal(s.queue.length, 0);
});

test("a failing run stops fetching the remaining tiles", async () => {
  const s = new Stitcher(new FakeCanvas());
  // More tiles than the 50-wide worker pool, so there is a tail to cancel.
  s.addTileTask(tile("https://example.com/fail-1"));
  for (let i = 0; i < 200; i++) {
    s.addTileTask(tile(`https://example.com/ok-${i}`));
  }

  await s.process().catch(() => {});
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(
    loads.length < 201,
    `expected the run to abort early, but all ${loads.length} tiles were fetched`
  );
});

test("tiles are drawn at their declared size, not a hardcoded 512", async () => {
  const canvas = new FakeCanvas();
  const s = new Stitcher(canvas);
  s.addTileTask(tile("https://example.com/ok-1", 0, 0, 416, 416));
  await s.process();

  assert.deepEqual(canvas.getContext().drawn, [
    { dx: 0, dy: 0, dw: 416, dh: 416 },
  ]);
});

test("a reused stitcher does not leak tiles between runs", async () => {
  const canvas = new FakeCanvas();
  const s = new Stitcher(canvas);

  s.addTileTask(tile("https://example.com/fail-1"));
  s.addTileTask(tile("https://example.com/ok-stale", 999, 999));
  await s.process().catch(() => {});

  const ctx = canvas.getContext();
  ctx.drawn.length = 0;

  s.addTileTask(tile("https://example.com/ok-fresh", 0, 0));
  await s.process();

  assert.deepEqual(
    ctx.drawn,
    [{ dx: 0, dy: 0, dw: 512, dh: 512 }],
    "second run must draw only its own tile"
  );
  assert.equal(s.toLoad, 1, "second run must not count the failed run's tiles");
});

// Loaders assign canvas.width before processing, which already resets the
// bitmap. This covers the direct-use case, where the size doesn't change and
// the explicit clear is the only thing removing the previous run's pixels.
test("clears the full canvas when driven directly", async () => {
  const canvas = new FakeCanvas();
  canvas.width = 1024;
  canvas.height = 512;

  const s = new Stitcher(canvas);
  s.addTileTask(tile("https://example.com/ok-1"));
  await s.process();

  assert.deepEqual(canvas.getContext().cleared, [
    { x: 0, y: 0, w: 1024, h: 512 },
  ]);
});

test("progress reaches 100% on a successful run", async () => {
  const s = new Stitcher(new FakeCanvas());
  const seen = [];
  s.onProgress = (p) => seen.push(p);
  for (let i = 0; i < 4; i++) s.addTileTask(tile(`https://example.com/ok-${i}`));

  await s.process();
  assert.equal(seen.at(-1), 100);
});
