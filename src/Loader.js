import { Stitcher } from "./Stitcher.js";

class Loader {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.stitcher = new Stitcher(this.canvas);
  }

  async load() {
    throw new Error(`${this.constructor.name} does not implement load()`);
  }

  onProgress(cb) {
    this.stitcher.onProgress = cb;
  }
}

export { Loader };
