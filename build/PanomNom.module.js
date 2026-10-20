// src/errors.js
var ErrorCodes = {
  NO_PANO_ID: "NO_PANO_ID",
  NO_IMAGE: "NO_IMAGE",
  ZERO_RESULTS: "ZERO_RESULTS",
  BAD_METADATA: "BAD_METADATA",
  INVALID_ZOOM: "INVALID_ZOOM",
  // A request never reached Google: offline, blocked, or refused by CORS.
  NETWORK: "NETWORK",
  // The load was superseded by another one on the same loader, or cancel() was called.
  CANCELLED: "CANCELLED",
  // A newer photo sphere whose media URL could not be found.
  NEEDS_MAPS_URL: "NEEDS_MAPS_URL",
  // Google is throttling this client. Distinguishable only because tiles are
  // fetched rather than loaded through an <img>, which cannot report a status.
  RATE_LIMITED: "RATE_LIMITED"
};
var PanomNomError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "PanomNomError";
    this.code = code;
  }
};

// src/Stitcher.js
var MAX_CONCURRENT = 6;
var MAX_ATTEMPTS = 3;
var RETRY_BASE_DELAY = 600;
var MAX_RETRY_AFTER = 1e4;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function retryDelay(attempt) {
  return RETRY_BASE_DELAY * 2 ** (attempt - 1) * (0.5 + Math.random());
}
function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1e3;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
async function loadTile(task, signal) {
  let res;
  try {
    res = await fetch(task.url, { mode: "cors", referrerPolicy: "no-referrer", signal });
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
      `Google is rate limiting tile requests (HTTP ${res.status}). Wait a few minutes, or construct the loader with a lower concurrency.`
    );
    error.retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    throw error;
  }
  if (!res.ok) {
    const error = new PanomNomError(
      ErrorCodes.NO_IMAGE,
      `Could not load tile ${task.url} (HTTP ${res.status})`
    );
    error.status = res.status;
    throw error;
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
var Stitcher = class {
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
    this.onProgress(this.toLoad === 0 ? 100 : this.loaded * 100 / this.toLoad);
  }
  // Consumes the queued tasks and draws them onto the canvas. Always starts
  // from a clean slate, so a Stitcher can be reused across loads. Aborting
  // `signal` stops the run, which then rejects with the signal's reason.
  async process(signal) {
    const tasks = this.queue.slice();
    this.reset();
    this.toLoad = tasks.length;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.updateProgress();
    if (tasks.length === 0) {
      return true;
    }
    const controller = new AbortController();
    if (signal?.aborted) throw signal.reason;
    const onAbort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let next = 0;
    const loadTileWithRetry = async (task) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await loadTile(task, controller.signal);
        } catch (e) {
          if (controller.signal.aborted || attempt >= MAX_ATTEMPTS) throw e;
          if (e.code === ErrorCodes.RATE_LIMITED) {
            if (e.retryAfter === null || e.retryAfter > MAX_RETRY_AFTER) throw e;
            this.retries++;
            await sleep(e.retryAfter);
            continue;
          }
          if (e.status >= 400 && e.status < 500) throw e;
          this.retries++;
          await sleep(retryDelay(attempt));
        }
      }
    };
    const worker = async () => {
      while (next < tasks.length && !controller.signal.aborted) {
        const task = tasks[next++];
        const bitmap = await loadTileWithRetry(task);
        if (controller.signal.aborted) {
          bitmap.close?.();
          return;
        }
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
      controller.abort(e);
      await Promise.allSettled(workers);
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    return true;
  }
};

// src/Loader.js
var Loader = class {
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
};

// src/utils.js
var GoogleStreetViewService;
var GoogleGeoCoder;
function getGoogleStreetViewService() {
  if (GoogleStreetViewService) return GoogleStreetViewService;
  GoogleStreetViewService = new google.maps.StreetViewService();
  return GoogleStreetViewService;
}
function getGoogleGeoCoder() {
  if (GoogleGeoCoder) return GoogleGeoCoder;
  GoogleGeoCoder = new google.maps.Geocoder();
  return GoogleGeoCoder;
}
async function resolveAddress(address) {
  const geocoder = getGoogleGeoCoder();
  try {
    const { results } = await geocoder.geocode({ address });
    return results[0].geometry.location;
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.ZERO_RESULTS,
      `Geocode was not successful for "${address}"`,
      { cause: e }
    );
  }
}
async function getPanoramaById(id) {
  const service = getGoogleStreetViewService();
  try {
    const { data } = await service.getPanorama({ pano: id });
    return data;
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.ZERO_RESULTS,
      `No panorama found for id "${id}"`,
      { cause: e }
    );
  }
}
async function getIdByLocation(lat, lon, { radius = 50, sources = ["google", "outdoor"] } = {}) {
  const service = getGoogleStreetViewService();
  const latLng = new google.maps.LatLng(lat, lon);
  try {
    return await service.getPanorama({
      location: latLng,
      radius,
      sources
    });
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.ZERO_RESULTS,
      `No panorama found near ${lat},${lon}`,
      { cause: e }
    );
  }
}
function getQueryVariable(url, variable) {
  for (const segment of url.split("?").slice(1)) {
    const value = new URLSearchParams(segment).get(variable);
    if (value) return value;
  }
  return null;
}
var ENTITY_KINDS = { 0: "street-view", 10: "photo-sphere" };
function decodePanoId(id) {
  if (!/^[A-Za-z0-9_-]+\.*$/.test(id)) return null;
  let bytes;
  try {
    const b64 = id.replace(/\.+$/, "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] !== 8 || bytes[2] !== 18) return null;
  const kind = bytes[1];
  const length = bytes[3];
  if (bytes.length < 4 + length) return null;
  const inner = String.fromCharCode(...bytes.slice(4, 4 + length));
  if (!/^[A-Za-z0-9_-]+$/.test(inner)) return null;
  return { kind: ENTITY_KINDS[kind] ?? null, id: inner };
}
function findPanoToken(decoded) {
  const withKind = decoded.match(/!1s([^!]+)!2e(\d+)/);
  if (withKind) return { id: withKind[1], kind: withKind[2] };
  const bare = decoded.match(/!1s([^!]+)/);
  return bare ? { id: bare[1], kind: null } : null;
}
function decodeURL(url) {
  try {
    return decodeURIComponent(url);
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.NO_PANO_ID,
      `Can't read the URL: it has a malformed %-escape`,
      { cause: e }
    );
  }
}
function findTileBase(decoded) {
  const candidate = decoded.match(/!6s(https?:\/\/[^!]+)/)?.[1];
  if (!candidate) return null;
  let host;
  try {
    host = new URL(candidate).hostname;
  } catch {
    return null;
  }
  if (!/(^|\.)googleusercontent\.com$/.test(host)) return null;
  return candidate.split("=")[0];
}
function parsePanoURL(url) {
  const decoded = decodeURL(url);
  const token = findPanoToken(decoded);
  const fromQuery = getQueryVariable(decoded, "panoid")?.split("!")[0];
  const id = token?.kind != null && token.id || fromQuery || token?.id;
  if (!id) {
    throw new PanomNomError(
      ErrorCodes.NO_PANO_ID,
      `Can't find panorama id in specified URL`
    );
  }
  return {
    id,
    kind: token?.id === id ? ENTITY_KINDS[token.kind] ?? null : null,
    tileBase: findTileBase(decoded)
  };
}
function getIdFromURL(url) {
  return parsePanoURL(url).id;
}

// src/photometa.js
var ENTITY_STREET_VIEW = 2;
var ENTITY_PHOTO_SPHERE = 10;
function photometaURL(id, kind) {
  return `https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=uk&pb=!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2suk!3m3!1m2!1e${kind}!2s${id}!4m61!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!1e17!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3!11m2!3m1!4b1`;
}
async function fetchPhotometa(id, kind, signal) {
  let res;
  try {
    res = await fetch(photometaURL(id, kind), { signal });
  } catch (e) {
    if (signal?.aborted) throw signal.reason;
    throw new PanomNomError(
      ErrorCodes.NETWORK,
      `photometa request for "${id}" did not reach Google`,
      { cause: e }
    );
  }
  if (!res.ok) {
    throw new PanomNomError(
      ErrorCodes.BAD_METADATA,
      `photometa request for "${id}" failed with ${res.status}`
    );
  }
  const text = await res.text();
  try {
    return JSON.parse(text.slice(4));
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.BAD_METADATA,
      `Could not parse photometa response for "${id}"`,
      { cause: e }
    );
  }
}
function pick(root, path, id) {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    if (node === null || node === void 0) {
      throw new PanomNomError(
        ErrorCodes.BAD_METADATA,
        `Unexpected photometa shape for "${id}": no value at [${path.slice(0, i).join("][")}]`
      );
    }
    node = node[path[i]];
  }
  if (node === null || node === void 0) {
    throw new PanomNomError(
      ErrorCodes.BAD_METADATA,
      `Unexpected photometa shape for "${id}": no value at [${path.join("][")}]`
    );
  }
  return node;
}
function tryPick(root, path) {
  let node = root;
  for (const key of path) {
    if (node === null || node === void 0) return void 0;
    node = node[key];
  }
  return node ?? void 0;
}
function extractAttribution(info) {
  return {
    copyright: tryPick(info, [1, 0, 4, 0, 0, 0, 0]),
    author: tryPick(info, [1, 0, 4, 1, 0, 0, 0]),
    authorURL: tryPick(info, [1, 0, 4, 1, 0, 1])
  };
}
async function getStreetViewMetadata(id, signal) {
  const info = await fetchPhotometa(id, ENTITY_STREET_VIEW, signal);
  const size = pick(info, [1, 0, 2, 2], id);
  const tile = pick(info, [1, 0, 2, 3, 1], id);
  return {
    tiles: {
      // photometa reports [height, width].
      worldSize: { width: size[1], height: size[0] },
      tileSize: { width: tile[1], height: tile[0] }
    },
    ...extractAttribution(info)
  };
}

// src/GoogleStreetViewLoader.js
function hasGoogleMaps() {
  return typeof google !== "undefined" && typeof google.maps?.StreetViewService === "function";
}
var GRID_32 = {
  levels: [1, 2, 4, 8, 16, 32],
  widths: [512, 1024, 2048, 4096, 8192, 16384]
};
var GRID_26 = {
  levels: [1, 2, 4, 7, 13, 26],
  widths: [416, 832, 1664, 3328, 6656, 13312]
};
var GoogleStreetViewLoader = class extends Loader {
  constructor(options = {}) {
    super(options);
    this.zoom = 1;
    this.metadata = {};
  }
  // zoom is an index into the tile pyramid: 0 is a single tile, 5 is full
  // resolution.
  async load(id, zoom = 1) {
    const signal = this.begin();
    const metadata = hasGoogleMaps() ? await getPanoramaById(id) : await getStreetViewMetadata(id, signal);
    signal.throwIfAborted();
    this.metadata = metadata;
    this.panoId = id;
    const { worldSize, tileSize } = metadata.tiles;
    const grid = worldSize.width / 512 === 32 ? GRID_32 : GRID_26;
    if (!Number.isInteger(zoom) || zoom < 0 || zoom >= grid.widths.length) {
      throw new PanomNomError(
        ErrorCodes.INVALID_ZOOM,
        `Zoom must be an integer between 0 and ${grid.widths.length - 1}, got ${zoom}`
      );
    }
    this.zoom = zoom;
    const aspectRatio = worldSize.width / worldSize.height;
    this.canvas.width = grid.widths[zoom];
    this.canvas.height = Math.round(this.canvas.width / aspectRatio);
    const w = grid.levels[zoom];
    const h = Math.ceil(w / aspectRatio);
    const getTileUrl = typeof metadata.tiles?.getTileUrl === "function" ? (x, y) => metadata.tiles.getTileUrl(id, zoom, x, y) : null;
    if (!getTileUrl) {
      const wrapped = decodePanoId(id);
      if (wrapped && wrapped.kind !== "street-view") {
        throw new PanomNomError(
          ErrorCodes.BAD_METADATA,
          `"${id}" is a ${wrapped.kind} (${wrapped.id}), not a Street View panorama. Its tiles are not served from the Street View endpoint \u2014 load "${wrapped.id}" with GooglePhotoSphereLoader instead.`
        );
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const url = getTileUrl ? getTileUrl(x, y) : `https://geo0.ggpht.com/cbk?cb_client=apiv3&authuser=0&hl=en&panoid=${id}&output=tile&x=${x}&y=${y}&zoom=${zoom}&nbt&fover=2`;
        this.stitcher.addTileTask({
          url,
          x: x * tileSize.width,
          y: y * tileSize.height,
          w: tileSize.width,
          h: tileSize.height
        });
      }
    }
    return this.stitcher.process(signal);
  }
};

// src/GooglePhotoSphereLoader.js
async function getPhotoSphereInfo(id, signal) {
  return fetchPhotometa(id, ENTITY_PHOTO_SPHERE, signal);
}
var GooglePhotoSphereLoader = class extends Loader {
  constructor(options = {}) {
    super(options);
    this.zoom = 1;
    this.metadata = {};
  }
  // Takes the id from a Maps URL, and the media id too when the URL has one.
  async loadFromURL(url, zoom = 1) {
    const { id, tileBase } = parsePanoURL(url);
    return this.load(id, zoom, { tileBase });
  }
  // `tileBase` overrides the tile endpoint for panoramas that aren't served
  // from lh3.ggpht.com/p/<id>. See parsePanoURL.
  async load(id, zoom = 1, { tileBase = null } = {}) {
    const signal = this.begin();
    const info = await getPhotoSphereInfo(id, signal);
    signal.throwIfAborted();
    this.panoId = id;
    const size = pick(info, [1, 0, 2, 2], id);
    const tile = pick(info, [1, 0, 2, 3, 1], id);
    const pyramid = pick(info, [1, 0, 2, 3, 0], id);
    this.metadata = {
      tiles: {
        worldSize: { width: size[1], height: size[0] },
        tileSize: { width: tile[1], height: tile[0] }
      },
      ...extractAttribution(info)
    };
    const levels = [];
    for (let i = 0; i < pyramid.length; i++) {
      levels.push({
        height: pick(info, [1, 0, 2, 3, 0, i, 0, 0], id),
        width: pick(info, [1, 0, 2, 3, 0, i, 0, 1], id)
      });
    }
    if (!Number.isInteger(zoom) || zoom < 0 || zoom >= levels.length) {
      throw new PanomNomError(
        ErrorCodes.INVALID_ZOOM,
        `Zoom must be an integer between 0 and ${levels.length - 1} for photo sphere "${id}", got ${zoom}`
      );
    }
    this.zoom = zoom;
    if (!tileBase && !id.startsWith("AF1Qip")) {
      tileBase = tryPick(info, [1, 0, 17, 0, 0])?.split("=")[0] ?? null;
      if (!tileBase) {
        throw new PanomNomError(
          ErrorCodes.NEEDS_MAPS_URL,
          `Photometa has no media URL for "${id}". Load it from its Google Maps URL instead, copied once the photo sphere has loaded (it has a !6s\u2026 part).`
        );
      }
    }
    const { tileSize } = this.metadata.tiles;
    const level = levels[zoom];
    this.canvas.width = level.width;
    this.canvas.height = level.height;
    const w = Math.ceil(level.width / tileSize.width);
    const h = Math.ceil(level.height / tileSize.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.stitcher.addTileTask({
          url: tileBase ? `${tileBase}=x${x}-y${y}-z${zoom}` : `https://lh3.ggpht.com/p/${id}=x${x}-y${y}-z${zoom}`,
          x: x * tileSize.width,
          y: y * tileSize.height,
          w: tileSize.width,
          h: tileSize.height
        });
      }
    }
    return this.stitcher.process(signal);
  }
};

// src/GoogleStreetViewDepthLoader.js
var NO_PLANE = Infinity;
function parseHeader(view) {
  return {
    headerSize: view.getUint8(0),
    numberOfPlanes: view.getUint16(1, true),
    width: view.getUint16(3, true),
    height: view.getUint16(5, true),
    offset: view.getUint16(7, true)
  };
}
function parsePlanes(header, view) {
  const indices = [];
  for (let i = 0; i < header.width * header.height; ++i) {
    indices.push(view.getUint8(header.offset + i));
  }
  const planes = [];
  for (let i = 0; i < header.numberOfPlanes; ++i) {
    const byteOffset = header.offset + header.width * header.height + i * 4 * 4;
    planes.push({
      n: [
        view.getFloat32(byteOffset, true),
        view.getFloat32(byteOffset + 4, true),
        view.getFloat32(byteOffset + 8, true)
      ],
      d: view.getFloat32(byteOffset + 12, true)
    });
  }
  return { planes, indices };
}
function computeDepthMap(header, indices, planes) {
  const w = header.width;
  const h = header.height;
  const depthMap = new Float32Array(w * h);
  const sin_theta = new Float32Array(h);
  const cos_theta = new Float32Array(h);
  const sin_phi = new Float32Array(w);
  const cos_phi = new Float32Array(w);
  for (let y = 0; y < h; ++y) {
    const theta = (h - y - 0.5) / h * Math.PI;
    sin_theta[y] = Math.sin(theta);
    cos_theta[y] = Math.cos(theta);
  }
  for (let x = 0; x < w; ++x) {
    const phi = (w - x - 0.5) / w * 2 * Math.PI + Math.PI / 2;
    sin_phi[x] = Math.sin(phi);
    cos_phi[x] = Math.cos(phi);
  }
  const v = [0, 0, 0];
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const planeIdx = indices[y * w + x];
      v[0] = sin_theta[y] * cos_phi[x];
      v[1] = sin_theta[y] * sin_phi[x];
      v[2] = cos_theta[y];
      if (planeIdx > 0) {
        const plane = planes[planeIdx];
        if (!plane) {
          throw new PanomNomError(
            ErrorCodes.BAD_METADATA,
            `Depth map pixel ${x},${y} points at plane ${planeIdx} of ${planes.length}`
          );
        }
        depthMap[y * w + (w - x - 1)] = Math.abs(
          plane.d / (v[0] * plane.n[0] + v[1] * plane.n[1] + v[2] * plane.n[2])
        );
      } else {
        depthMap[y * w + (w - x - 1)] = NO_PLANE;
      }
    }
  }
  return { width: w, height: h, depthMap };
}
var GoogleStreetViewDepthLoader = class {
  // Set `fallbackToEmpty` to receive an all-sky depth map instead of an error
  // when a panorama has no depth data.
  constructor({ fallbackToEmpty = false } = {}) {
    this.fallbackToEmpty = fallbackToEmpty;
    this.depthMap = null;
  }
  async load(panoId) {
    const json = await fetchPhotometa(panoId, ENTITY_STREET_VIEW);
    try {
      const raw = tryPick(json, [1, 0, 5, 0, 5, 1, 2]);
      if (typeof raw !== "string") {
        throw new PanomNomError(
          ErrorCodes.BAD_METADATA,
          `No depth map for "${panoId}". Some panoramas have none, and Google sends none to headless browsers.`
        );
      }
      this.depthMap = this.parse(this.decode(raw));
    } catch (e) {
      if (!this.fallbackToEmpty) {
        throw e instanceof PanomNomError ? e : new PanomNomError(
          ErrorCodes.BAD_METADATA,
          `Could not decode depth map for "${panoId}"`,
          { cause: e }
        );
      }
      this.depthMap = createEmptyDepthMap();
    }
    return this.depthMap;
  }
  decode(rawDepthMap) {
    let data = rawDepthMap;
    while (data.length % 4 != 0) data += "=";
    data = data.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(data);
    const depthMap = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; ++i) depthMap[i] = decoded.charCodeAt(i);
    return depthMap;
  }
  parse(bytes) {
    const view = new DataView(bytes.buffer);
    const header = parseHeader(view);
    const required = header.offset + header.width * header.height + header.numberOfPlanes * 16;
    if (bytes.length < required) {
      throw new PanomNomError(
        ErrorCodes.BAD_METADATA,
        `Depth map truncated: header needs ${required} bytes, got ${bytes.length}`
      );
    }
    const { planes, indices } = parsePlanes(header, view);
    return computeDepthMap(header, indices, planes);
  }
};
function createEmptyDepthMap(width = 512, height = 256) {
  const depthMap = new Float32Array(width * height);
  depthMap.fill(NO_PLANE);
  return { width, height, depthMap };
}
export {
  ErrorCodes,
  GooglePhotoSphereLoader,
  GoogleStreetViewDepthLoader,
  GoogleStreetViewLoader,
  NO_PLANE,
  PanomNomError,
  createEmptyDepthMap,
  decodePanoId,
  getIdByLocation,
  getIdFromURL,
  getPanoramaById,
  parsePanoURL,
  resolveAddress
};
