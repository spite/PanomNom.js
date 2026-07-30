import { Stitcher } from "./Stitcher.js";

class Loader {
  // Options are forwarded to the Stitcher; `concurrency` caps how many tiles
  // are fetched at once, which is the setting that matters if Google starts
  // returning 429.
  constructor(options = {}) {
    this.canvas = document.createElement("canvas");
    this.stitcher = new Stitcher(this.canvas, options);
  }

  async load() {
    throw new Error(`${this.constructor.name} does not implement load()`);
  }

  onProgress(cb) {
    this.stitcher.onProgress = cb;
  }
}

export { Loader };
