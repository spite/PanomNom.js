import { PanomNomError, ErrorCodes } from "./errors.js";

// Google rate-limits the tile hosts per client, and a full panorama is
// hundreds of tiles. The old default of 50 in flight tripped that readily,
// returning 429 for every tile and failing the load. Browsers cap HTTP/1.1 at
// roughly six connections per host anyway; HTTP/2 removes that cap, so the
// limit has to be imposed here.
const MAX_CONCURRENT = 6;

// One dropped tile should not lose the whole panorama, so tiles are retried.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 600;

// Cap on how long a Retry-After will be honoured before giving up instead.
const MAX_RETRY_AFTER = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential with jitter, so a whole pool that fails together doesn't retry in
// lockstep and hit the limiter as one burst again.
function retryDelay(attempt) {
  return RETRY_BASE_DELAY * 2 ** (attempt - 1) * (0.5 + Math.random());
}

// Retry-After is either a delay in seconds or an HTTP date.
function parseRetryAfter(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// Fetches a tile and decodes it to an ImageBitmap.
//
// This goes through fetch rather than an <img> so the status code is visible.
// An <img> reports only "error", which makes a 429 indistinguishable from a
// dropped connection — and retrying a rate limit is the one response that makes
// it worse.
async function loadTile(task, signal) {
  let res;
  try {
    res = await fetch(task.url, { mode: "cors", signal });
  } catch (e) {
    if (signal.aborted) throw signal.reason ?? e;
    throw new PanomNomError(
      ErrorCodes.NO_IMAGE,
      `Could not load tile ${task.url}`,
      { cause: e }
    );
  }

  if (res.status === 429 || res.status === 503) {
    const error = new PanomNomError(
      ErrorCodes.RATE_LIMITED,
      `Google is rate limiting tile requests (HTTP ${res.status}). ` +
        `Wait a few minutes, or construct the loader with a lower concurrency.`
    );
    error.retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    throw error;
  }

  if (!res.ok) {
    throw new PanomNomError(
      ErrorCodes.NO_IMAGE,
      `Could not load tile ${task.url} (HTTP ${res.status})`
    );
  }

  try {
    return await createImageBitmap(await res.blob());
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.NO_IMAGE,
      `Tile ${task.url} was not a decodable image`,
      { cause: e }
    );
  }
}

class Stitcher {
  // `concurrency` is worth lowering further if you are loading several
  // panoramas in a row and seeing rate limits.
  constructor(canvas, { concurrency = MAX_CONCURRENT } = {}) {
    this.concurrency = concurrency;
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
    const controller = new AbortController();
    let next = 0;

    const loadTileWithRetry = async (task) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await loadTile(task, controller.signal);
        } catch (e) {
          if (controller.signal.aborted || attempt >= MAX_ATTEMPTS) throw e;

          if (e.code === ErrorCodes.RATE_LIMITED) {
            // Only wait if the server said how long and it is short. Otherwise
            // fail now: retrying into a limiter is what deepens it.
            if (e.retryAfter === null || e.retryAfter > MAX_RETRY_AFTER) throw e;
            this.retries++;
            await sleep(e.retryAfter);
            continue;
          }

          this.retries++;
          await sleep(retryDelay(attempt));
        }
      }
    };

    const worker = async () => {
      while (next < tasks.length && !controller.signal.aborted) {
        const task = tasks[next++];
        const bitmap = await loadTileWithRetry(task);
        this.ctx.drawImage(
          bitmap,
          0,
          0,
          bitmap.width,
          bitmap.height,
          task.x,
          task.y,
          task.w,
          task.h
        );
        bitmap.close?.();
        this.loaded++;
        this.updateProgress();
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(tasks.length, this.concurrency); i++) {
      workers.push(worker());
    }

    try {
      await Promise.all(workers);
    } catch (e) {
      // Cancel whatever is still in flight, then let the workers settle so none
      // of them draw after we return.
      controller.abort(e);
      await Promise.allSettled(workers);
      throw e;
    }

    return true;
  }
}

export { Stitcher };
