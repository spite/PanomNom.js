import { PanomNomError, ErrorCodes } from "./errors.js";

const MAX_CONCURRENT = 50;

// Firing every tile at once can make the browser drop image loads that would
// otherwise succeed, and one dropped tile used to fail the whole panorama.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loads a tile into an Image. Rejects with NO_IMAGE if the request fails, or
// with `run.reason` if the run has been cancelled.
//
// Cancellation goes through `run.inflight` rather than an abort listener per
// tile: with MAX_CONCURRENT tiles in the air that would be 50 listeners on one
// signal, which trips EventTarget's leak warning.
function loadTile(task, run) {
  return new Promise((resolve, reject) => {
    if (run.cancelled) {
      reject(run.reason);
      return;
    }

    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";

    // Detach everything before settling, so a cancelled tile can't fire again
    // when we clear its src below.
    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      run.inflight.delete(cancel);
    };

    const onLoad = () => {
      cleanup();
      resolve(img);
    };

    const onError = () => {
      cleanup();
      reject(
        new PanomNomError(ErrorCodes.NO_IMAGE, `Could not load tile ${task.url}`)
      );
    };

    const cancel = () => {
      cleanup();
      // Assigning an empty src aborts the in-flight request.
      img.src = "";
      reject(run.reason);
    };

    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    run.inflight.add(cancel);
    img.src = task.url;
  });
}

class Stitcher {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");
    this.queue = [];
    this.toLoad = 0;
    this.loaded = 0;
    this.retries = 0;
    this.onProgress = null;
  }

  reset() {
    this.queue.length = 0;
    this.toLoad = 0;
    this.loaded = 0;
    this.retries = 0;
  }

  addTileTask(task) {
    this.queue.push(task);
  }

  updateProgress() {
    if (!this.onProgress) return;
    // A run with nothing to do is trivially complete, not NaN% complete.
    this.onProgress(this.toLoad === 0 ? 100 : (this.loaded * 100) / this.toLoad);
  }

  // Consumes the queued tasks and draws them onto the canvas. Always starts
  // from a clean slate, so a Stitcher can be reused across loads.
  async process() {
    const tasks = this.queue.slice();
    this.reset();

    this.toLoad = tasks.length;
    // Redundant when driven by a Loader, since those set canvas.width first and
    // that already resets the bitmap. It matters when a Stitcher is used
    // directly against a canvas whose size hasn't changed.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.updateProgress();

    if (tasks.length === 0) {
      return true;
    }

    // One failure aborts the whole run: there is no point downloading the rest
    // of a panorama that cannot be completed.
    const run = { cancelled: false, reason: null, inflight: new Set() };
    let next = 0;

    // Retry a tile a couple of times before giving up on the whole run. Image
    // events can't tell a 404 from a dropped connection, so this retries both;
    // a genuinely missing tile just costs MAX_ATTEMPTS requests.
    const loadTileWithRetry = async (task) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await loadTile(task, run);
        } catch (e) {
          if (run.cancelled || attempt >= MAX_ATTEMPTS) throw e;
          this.retries++;
          await sleep(RETRY_DELAY * attempt);
        }
      }
    };

    const worker = async () => {
      while (next < tasks.length && !run.cancelled) {
        const task = tasks[next++];
        const img = await loadTileWithRetry(task);
        this.ctx.drawImage(
          img,
          0,
          0,
          img.naturalWidth,
          img.naturalHeight,
          task.x,
          task.y,
          task.w,
          task.h
        );
        this.loaded++;
        this.updateProgress();
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(tasks.length, MAX_CONCURRENT); i++) {
      workers.push(worker());
    }

    try {
      await Promise.all(workers);
    } catch (e) {
      run.cancelled = true;
      run.reason = e;
      // Cancel whatever is still in the air, then let the workers settle so
      // none of them draw after we return.
      for (const cancel of [...run.inflight]) cancel();
      await Promise.allSettled(workers);
      throw e;
    }

    return true;
  }
}

export { Stitcher };
