import { Loader } from "./Loader.js";
import { PanomNomError, ErrorCodes } from "./errors.js";
import { parsePanoURL } from "./utils.js";
import {
  fetchPhotometa,
  pick,
  tryPick,
  extractAttribution,
  ENTITY_PHOTO_SPHERE,
} from "./photometa.js";

// Photo sphere ids look like AF1QipMKVZBKb5dP2my1FWB2ljCp2vXqiISTzj056YD_, or
// CIHM0ogKEICAgIDCqvKvNg for newer ones. Unlike Street View, this loader needs no
// Google Maps API key or script: the metadata comes straight from photometa, and
// the tiles from lh3.ggpht.com or, for newer ones, the media photometa names.
async function getPhotoSphereInfo(id, signal) {
  return fetchPhotometa(id, ENTITY_PHOTO_SPHERE, signal);
}

class GooglePhotoSphereLoader extends Loader {
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
        tileSize: { width: tile[1], height: tile[0] },
      },
      ...extractAttribution(info),
    };

    // Unlike Street View, the pyramid depth and its dimensions vary per photo
    // sphere, and Google gives each level explicitly as [height, width].
    const levels = [];
    for (let i = 0; i < pyramid.length; i++) {
      levels.push({
        height: pick(info, [1, 0, 2, 3, 0, i, 0, 0], id),
        width: pick(info, [1, 0, 2, 3, 0, i, 0, 1], id),
      });
    }

    if (!Number.isInteger(zoom) || zoom < 0 || zoom >= levels.length) {
      throw new PanomNomError(
        ErrorCodes.INVALID_ZOOM,
        `Zoom must be an integer between 0 and ${levels.length - 1} for photo sphere "${id}", got ${zoom}`
      );
    }
    this.zoom = zoom;

    // Only the older AF1Qip… photo spheres are served from lh3.ggpht.com/p/<id>;
    // photometa names the media the newer ones are served from.
    if (!tileBase && !id.startsWith("AF1Qip")) {
      tileBase = tryPick(info, [1, 0, 17, 0, 0])?.split("=")[0] ?? null;
      if (!tileBase) {
        throw new PanomNomError(
          ErrorCodes.NEEDS_MAPS_URL,
          `Photometa has no media URL for "${id}". Load it from its Google Maps URL ` +
            `instead, copied once the photo sphere has loaded (it has a !6s… part).`
        );
      }
    }

    const { tileSize } = this.metadata.tiles;
    const level = levels[zoom];

    this.canvas.width = level.width;
    this.canvas.height = level.height;

    // Derive the grid from the level's real size. Assuming it doubles per zoom
    // overshoots whenever a level is an exact multiple of the tile size, and
    // the extra row or column 404s.
    const w = Math.ceil(level.width / tileSize.width);
    const h = Math.ceil(level.height / tileSize.height);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.stitcher.addTileTask({
          url: tileBase
            ? `${tileBase}=x${x}-y${y}-z${zoom}`
            : `https://lh3.ggpht.com/p/${id}=x${x}-y${y}-z${zoom}`,
          x: x * tileSize.width,
          y: y * tileSize.height,
          w: tileSize.width,
          h: tileSize.height,
        });
      }
    }

    return this.stitcher.process(signal);
  }
}

export { GooglePhotoSphereLoader };
