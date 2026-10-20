import { Stitcher } from "./Stitcher.js";
import { PanomNomError, ErrorCodes } from "./errors.js";

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

  // Starts a run and cancels the one before it, so two loads never share the canvas.
  begin() {
    this.cancel();
    this.controller = new AbortController();
    return this.controller.signal;
  }

  // Stops the load in progress, which then rejects with CANCELLED.
  cancel() {
    this.controller?.abort(
      new PanomNomError(ErrorCodes.CANCELLED, `${this.constructor.name} load was cancelled`)
    );
  }

  onProgress(cb) {
    this.stitcher.onProgress = cb;
  }
}

export { Loader };
