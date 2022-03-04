// ../src/Stitcher.js
var Stitcher = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");
    this.queue = [];
    this.toLoad = 0;
    this.loaded = 0;
    this.onProgress = null;
  }
  reset() {
    this.toLoad = 0;
    this.loaded = 0;
  }
  addTileTask(task) {
    this.queue.push(task);
    this.toLoad++;
  }
  updateProgress() {
    const p = this.loaded * 100 / this.toLoad;
    if (this.onProgress) {
      this.onProgress(p);
    }
  }
  processQueue() {
    this.updateProgress();
    if (this.loaded === this.toLoad) {
      if (this.resolve) {
        this.resolve(true);
        this.resolve = null;
      }
      return;
    }
    if (this.queue.length === 0) {
      return;
    }
    const task = this.queue.shift();
    let img = new Image();
    img.decoding = "async";
    img.addEventListener("load", () => {
      this.loaded++;
      this.ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, task.x, task.y, 512, 512);
      this.processQueue();
      img = null;
    });
    img.addEventListener("error", (e) => {
      this.reject("NO_IMAGE");
      img = null;
    });
    img.crossOrigin = "";
    img.src = task.url;
  }
  async process() {
    this.toLoad = this.queue.length;
    this.loaded = 0;
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      const concurrent = Math.min(this.queue.length, 1);
      for (let i = 0; i < concurrent; i++) {
        this.processQueue();
      }
    });
  }
};

// ../src/Loader.js
var Loader = class {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.stitcher = new Stitcher(this.canvas);
  }
  async load() {
  }
  onProgress(cb) {
    this.stitcher.onProgress = cb;
  }
};

// ../src/base64.js
var base64 = {};
base64.PADCHAR = "=";
base64.ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
base64.makeDOMException = function() {
  var e, tmp;
  try {
    return new DOMException(DOMException.INVALID_CHARACTER_ERR);
  } catch (tmp2) {
    var ex = new Error("DOM Exception 5");
    ex.code = ex.number = 5;
    ex.name = ex.description = "INVALID_CHARACTER_ERR";
    ex.toString = function() {
      return "Error: " + ex.name + ": " + ex.message;
    };
    return ex;
  }
};
base64.getbyte64 = function(s, i) {
  var idx = base64.ALPHA.indexOf(s.charAt(i));
  if (idx === -1) {
    throw base64.makeDOMException();
  }
  return idx;
};
base64.decode = function(s) {
  s = "" + s;
  var getbyte64 = base64.getbyte64;
  var pads, i, b10;
  var imax = s.length;
  if (imax === 0) {
    return s;
  }
  if (imax % 4 !== 0) {
    throw base64.makeDOMException();
  }
  pads = 0;
  if (s.charAt(imax - 1) === base64.PADCHAR) {
    pads = 1;
    if (s.charAt(imax - 2) === base64.PADCHAR) {
      pads = 2;
    }
    imax -= 4;
  }
  var x = [];
  for (i = 0; i < imax; i += 4) {
    b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12 | getbyte64(s, i + 2) << 6 | getbyte64(s, i + 3);
    x.push(String.fromCharCode(b10 >> 16, b10 >> 8 & 255, b10 & 255));
  }
  switch (pads) {
    case 1:
      b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12 | getbyte64(s, i + 2) << 6;
      x.push(String.fromCharCode(b10 >> 16, b10 >> 8 & 255));
      break;
    case 2:
      b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12;
      x.push(String.fromCharCode(b10 >> 16));
      break;
  }
  return x.join("");
};
base64.getbyte = function(s, i) {
  var x = s.charCodeAt(i);
  if (x > 255) {
    throw base64.makeDOMException();
  }
  return x;
};
base64.encode = function(s) {
  if (arguments.length !== 1) {
    throw new SyntaxError("Not enough arguments");
  }
  var padchar = base64.PADCHAR;
  var alpha = base64.ALPHA;
  var getbyte = base64.getbyte;
  var i, b10;
  var x = [];
  s = "" + s;
  var imax = s.length - s.length % 3;
  if (s.length === 0) {
    return s;
  }
  for (i = 0; i < imax; i += 3) {
    b10 = getbyte(s, i) << 16 | getbyte(s, i + 1) << 8 | getbyte(s, i + 2);
    x.push(alpha.charAt(b10 >> 18));
    x.push(alpha.charAt(b10 >> 12 & 63));
    x.push(alpha.charAt(b10 >> 6 & 63));
    x.push(alpha.charAt(b10 & 63));
  }
  switch (s.length - imax) {
    case 1:
      b10 = getbyte(s, i) << 16;
      x.push(alpha.charAt(b10 >> 18) + alpha.charAt(b10 >> 12 & 63) + padchar + padchar);
      break;
    case 2:
      b10 = getbyte(s, i) << 16 | getbyte(s, i + 1) << 8;
      x.push(alpha.charAt(b10 >> 18) + alpha.charAt(b10 >> 12 & 63) + alpha.charAt(b10 >> 6 & 63) + padchar);
      break;
  }
  return x.join("");
};

// ../src/utils.js
var GoogleStreetViewService;
function getGoogleStreetViewService() {
  if (GoogleStreetViewService)
    return GoogleStreetViewService;
  GoogleStreetViewService = new google.maps.StreetViewService();
  return GoogleStreetViewService;
}
async function getPanoramaById(id) {
  const service = getGoogleStreetViewService();
  return new Promise((resolve, reject) => {
    service.getPanorama({pano: id}, (data, status) => {
      if (data) {
        resolve(data);
      } else {
        reject(status);
      }
    });
  });
}
async function getIdByLocation(lat, lon) {
  const service = getGoogleStreetViewService();
  const latLng = new google.maps.LatLng(lat, lon);
  try {
    const res = await service.getPanorama({
      location: latLng,
      radius: 50,
      source: "outdoor"
    });
    return res;
  } catch (e) {
    throw e;
  }
}
function getQueryVariable(query, variable) {
  const parts = query.split("?");
  const params = new URLSearchParams(parts[1]);
  return params.get(variable);
}
function getIdFromURL(url) {
  url = decodeURIComponent(url);
  if (url.indexOf("panoid") != -1) {
    const panoId = getQueryVariable(url, "panoid");
    return panoId;
  } else if (url.indexOf("!1s") != -1) {
    const pos = url.indexOf("!1s") + 3;
    const npos = url.substr(pos).indexOf("!");
    const panoId = url.substr(pos, npos);
    return panoId;
  } else {
    throw new Error(`Can't find panorama id in specified URL`);
  }
}

// ../src/GoogleStreetViewLoader.js
var GoogleStreetViewLoader = class extends Loader {
  constructor() {
    super();
    this.service = getGoogleStreetViewService();
    this.zoom = 1;
    this.metadata = {};
  }
  async load(id, zoom) {
    if (zoom === void 0) {
      console.warn("No zoom provided, assuming 1");
      zoom = 1;
    }
    this.zoom = zoom;
    this.panoId = id;
    const metadata = await getPanoramaById(id);
    this.metadata = metadata;
    const aspectRatio = this.metadata.tiles.worldSize.width / this.metadata.tiles.worldSize.height;
    let widths;
    let levels;
    if (this.metadata.tiles.worldSize.width / 512 === 32) {
      levels = [1, 2, 4, 8, 16, 32];
      widths = [512, 1024, 2048, 4096, 8192, 16384];
    } else {
      levels = [1, 2, 4, 7, 13, 26];
      widths = [416, 832, 1664, 3328, 6656, 13312];
    }
    this.canvas.width = widths[zoom];
    this.canvas.height = this.canvas.width / aspectRatio;
    const tileWidth = this.metadata.tiles.tileSize.width;
    const tileHeight = this.metadata.tiles.tileSize.height;
    const w = levels[zoom];
    const h = w / aspectRatio;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const url = `https://geo0.ggpht.com/cbk?cb_client=maps_sv.tactile&authuser=0&hl=en&panoid=${id}&output=tile&x=${x}&y=${y}&zoom=${zoom}&nbt&fover=2`;
        this.stitcher.addTileTask({
          url,
          x: x * tileWidth,
          y: y * tileHeight
        });
      }
    }
    const res = await this.stitcher.process();
    return res;
  }
};

// ../src/GooglePhotoSphereLoader.js
async function getPhotoSphereInfo(id) {
  const url = `https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=uk&pb=!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2suk!3m3!1m2!1e10!2s${id}!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3`;
  const res = await fetch(url);
  const text = await res.text();
  const info = JSON.parse(text.substr(4));
  return info;
}
var GooglePhotoSphereLoader = class extends Loader {
  constructor() {
    super();
    this.service = getGoogleStreetViewService();
    this.zoom = 1;
    this.metadata = {};
  }
  async load(id, zoom) {
    if (zoom === void 0) {
      console.warn("No zoom provided, assuming 1");
      zoom = 1;
    }
    this.zoom = zoom;
    this.panoId = id;
    const metadata = await getPhotoSphereInfo(id);
    this.metadata = {
      tiles: {
        worldSize: {
          width: metadata[1][0][2][2][1],
          height: metadata[1][0][2][2][0]
        },
        tileSize: {
          width: metadata[1][0][2][3][1][1],
          height: metadata[1][0][2][3][1][0]
        }
      }
    };
    const aspectRatio = this.metadata.tiles.worldSize.width / this.metadata.tiles.worldSize.height;
    const widths = [];
    const levels = [];
    let level = 1;
    for (const w2 of metadata[1][0][2][3][0]) {
      widths.push(w2[0][1]);
      levels.push(level);
      level *= 2;
    }
    this.canvas.width = widths[zoom];
    this.canvas.height = this.canvas.width / aspectRatio;
    const tileWidth = this.metadata.tiles.tileSize.width;
    const tileHeight = this.metadata.tiles.tileSize.height;
    const w = levels[zoom];
    const h = w / aspectRatio;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const url = `https://lh3.ggpht.com/p/${id}=x${x}-y${y}-z${zoom}`;
        this.stitcher.addTileTask({
          url,
          x: x * tileWidth,
          y: y * tileHeight
        });
      }
    }
    const res = await this.stitcher.process();
    return res;
  }
};
export {
  GooglePhotoSphereLoader,
  GoogleStreetViewLoader,
  getIdByLocation,
  getIdFromURL
};
