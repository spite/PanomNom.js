// Minimal browser stubs so the pure logic can be tested under node.
//
// Tiles are fetched, so the stub is a fake `fetch` plus `createImageBitmap`.
// Behaviour is driven by the url:
//
//   .../fail-N              always fails to fetch
//   .../flaky-N             fails its first N attempts, then succeeds
//   .../ratelimit           429 with a Retry-After of 1 second
//   .../ratelimit-forever   429 with no Retry-After
//   .../notimage            200, but the body will not decode
//
// `loads` records every url requested, which is how tests assert that a failed
// run stops fetching the remainder.

const loads = [];
const attempts = new Map();

// A stand-in for the decoded tile. Real ImageBitmaps expose width/height/close.
class FakeBitmap {
  constructor() {
    this.width = 512;
    this.height = 512;
    this.closed = false;
  }
  close() {
    this.closed = true;
  }
}

const NOT_AN_IMAGE = "not-an-image";

function fakeResponse(status, { body = "jpeg", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    async blob() {
      return body;
    },
  };
}

async function fakeFetch(url, { signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  loads.push(url);

  // Yield a macrotask: real requests cannot all settle within one turn, and
  // tests that race the retry backoff depend on that.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");

  if (url.includes("ratelimit-forever")) return fakeResponse(429);
  if (url.includes("ratelimit")) {
    return fakeResponse(429, { headers: { "retry-after": "1" } });
  }
  if (url.includes("notimage")) return fakeResponse(200, { body: NOT_AN_IMAGE });

  const flaky = url.match(/flaky-(\d+)/);
  if (flaky) {
    const seen = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, seen);
    if (seen <= Number(flaky[1])) throw new TypeError("network error");
    return fakeResponse(200);
  }

  if (url.includes("fail")) throw new TypeError("network error");
  return fakeResponse(200);
}

async function fakeCreateImageBitmap(blob) {
  if (blob === NOT_AN_IMAGE) throw new Error("undecodable");
  return new FakeBitmap();
}

class FakeContext {
  constructor() {
    this.drawn = [];
    this.cleared = [];
  }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    this.drawn.push({ dx, dy, dw, dh });
  }
  clearRect(x, y, w, h) {
    this.cleared.push({ x, y, w, h });
  }
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this._ctx = new FakeContext();
  }
  getContext() {
    return this._ctx;
  }
}

function installDOM() {
  globalThis.fetch = fakeFetch;
  globalThis.createImageBitmap = fakeCreateImageBitmap;
  globalThis.document = {
    createElement(tag) {
      if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
      return new FakeCanvas();
    },
  };
  loads.length = 0;
  attempts.clear();
}

export { installDOM, loads, FakeCanvas };
