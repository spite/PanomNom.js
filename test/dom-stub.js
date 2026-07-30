// Minimal browser stubs so the pure logic can be tested under node.
//
// `Image` resolves or fails based on the url: anything containing "fail"
// dispatches an error event. `loads` records every url that was started, which
// is how the tests assert that a failed run stops fetching the remainder.

const loads = [];

// urls containing "flaky-N" fail their first N attempts, then succeed. Used to
// exercise the retry path without relying on the network.
const attempts = new Map();

class FakeImage {
  constructor() {
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    this._listeners = {};
    this._src = "";
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }

  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter(
      (f) => f !== fn
    );
  }

  _emit(type) {
    for (const fn of [...(this._listeners[type] || [])]) fn();
  }

  set src(value) {
    this._src = value;
    if (!value) return;
    loads.push(value);
    const flaky = value.match(/flaky-(\d+)/);
    // A macrotask, not a microtask: real image loads cannot all settle inside
    // one turn, and tests that race the retry backoff depend on that.
    setTimeout(() => {
      if (flaky) {
        const seen = (attempts.get(value) ?? 0) + 1;
        attempts.set(value, seen);
        this._emit(seen <= Number(flaky[1]) ? "error" : "load");
        return;
      }
      this._emit(value.includes("fail") ? "error" : "load");
    }, 0);
  }

  get src() {
    return this._src;
  }
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
  globalThis.Image = FakeImage;
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
