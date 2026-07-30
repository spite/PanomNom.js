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
  // Far more tiles than the pool can drain while the failing tile exhausts its
  // retries, so there is still a tail left to cancel when the run gives up.
  s.addTileTask(tile("https://example.com/fail-1"));
  for (let i = 0; i < 100000; i++) {
    s.addTileTask(tile(`https://example.com/ok-${i}`));
  }

  await s.process().catch(() => {});
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(
    loads.length < 100001,
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

test("a tile that fails once is retried rather than failing the run", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/flaky-1-once"));
  s.addTileTask(tile("https://example.com/ok-1"));

  assert.equal(await s.process(), true);
  assert.equal(s.loaded, 2);
  assert.equal(s.retries, 1);
});

test("retries are bounded, so a dead tile still fails the run", async () => {
  const s = new Stitcher(new FakeCanvas());
  // Fails more times than MAX_ATTEMPTS allows.
  s.addTileTask(tile("https://example.com/flaky-99"));

  await assert.rejects(s.process(), (e) => e.code === ErrorCodes.NO_IMAGE);
  assert.equal(loads.filter((u) => u.includes("flaky-99")).length, 3);
});

test("retry count resets between runs", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/flaky-1-reset"));
  await s.process();
  assert.equal(s.retries, 1);

  s.addTileTask(tile("https://example.com/ok-2"));
  await s.process();
  assert.equal(s.retries, 0);
});

test("concurrency is capped, and configurable", async () => {
  // The default has to stay modest: Google rate-limits the tile hosts, and 429s
  // are indistinguishable from any other image error.
  const s = new Stitcher(new FakeCanvas(), { concurrency: 3 });
  for (let i = 0; i < 50; i++) {
    s.addTileTask(tile(`https://example.com/ok-${i}`));
  }

  // The stub settles on a macrotask, so every tile requested before the first
  // response arrives is genuinely concurrent. With a pool of 3 that is 3.
  const started = [];
  const before = loads.length;
  const p = s.process();
  await Promise.resolve();
  started.push(loads.length - before);
  await p;

  assert.equal(started[0], 3, `expected 3 tiles in the first burst`);
  assert.equal(s.loaded, 50);
});

test("the default concurrency is modest enough not to trip rate limits", async () => {
  const s = new Stitcher(new FakeCanvas());
  assert.ok(s.concurrency <= 8, `default concurrency is ${s.concurrency}`);
});

test("a rate limited tile fails with RATE_LIMITED, not NO_IMAGE", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/ratelimit-forever-1"));

  await assert.rejects(s.process(), (e) => {
    assert.equal(e.code, ErrorCodes.RATE_LIMITED);
    assert.match(e.message, /rate limiting/);
    return true;
  });
});

test("a rate limit with no Retry-After is not retried", async () => {
  // Retrying into a limiter is what deepens it.
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/ratelimit-forever-2"));

  await s.process().catch(() => {});
  assert.equal(
    loads.filter((u) => u.includes("ratelimit-forever-2")).length,
    1,
    "should have given up after the first 429"
  );
  assert.equal(s.retries, 0);
});

test("a short Retry-After is honoured", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/ratelimit-1"));

  await s.process().catch(() => {});
  // Retry-After is 1s, under the cap, so it waits and tries again.
  assert.ok(s.retries > 0, "expected the Retry-After to be honoured");
  assert.ok(loads.filter((u) => u.includes("ratelimit-1")).length > 1);
});

test("an undecodable tile is NO_IMAGE, not a rate limit", async () => {
  const s = new Stitcher(new FakeCanvas());
  s.addTileTask(tile("https://example.com/notimage-1"));

  await assert.rejects(s.process(), (e) => e.code === ErrorCodes.NO_IMAGE);
});

test("decoded bitmaps are released after drawing", async () => {
  const canvas = new FakeCanvas();
  const s = new Stitcher(canvas);
  s.addTileTask(tile("https://example.com/ok-close"));
  await s.process();
  assert.equal(canvas.getContext().drawn.length, 1);
});
