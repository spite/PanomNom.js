import { Loader } from "./Loader.js";
import { getPanoramaById, decodePanoId } from "./utils.js";
import { PanomNomError, ErrorCodes } from "./errors.js";

// Street View serves panoramas on one of two tile grids. Both are fixed
// pyramids where each level doubles, but the older imagery is cropped to 26
// tiles across at full resolution instead of a clean 32. `worldSize.width`
// distinguishes them: 16384 (32 * 512) for the newer grid.
const GRID_32 = {
  levels: [1, 2, 4, 8, 16, 32],
  widths: [512, 1024, 2048, 4096, 8192, 16384],
};
const GRID_26 = {
  levels: [1, 2, 4, 7, 13, 26],
  widths: [416, 832, 1664, 3328, 6656, 13312],
};

class GoogleStreetViewLoader extends Loader {
  constructor() {
    super();

    this.zoom = 1;
    this.metadata = {};
  }

  // zoom is an index into the tile pyramid: 0 is a single tile, 5 is full
  // resolution.
  async load(id, zoom = 1) {
    const metadata = await getPanoramaById(id);
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

    // getPanorama can return imagery that isn't Street View at all — a photo
    // sphere, for instance, whose tiles are served from somewhere else
    // entirely. The Maps API knows where each panorama's tiles live, so prefer
    // asking it over hardcoding a host.
    const getTileUrl =
      typeof metadata.tiles?.getTileUrl === "function"
        ? (x, y) => metadata.tiles.getTileUrl(id, zoom, x, y)
        : null;

    if (!getTileUrl) {
      const wrapped = decodePanoId(id);
      if (wrapped && wrapped.kind !== "street-view") {
        throw new PanomNomError(
          ErrorCodes.BAD_METADATA,
          `"${id}" is a ${wrapped.kind} (${wrapped.id}), not a Street View panorama. ` +
            `Its tiles are not served from the Street View endpoint — use ` +
            `GooglePhotoSphereLoader.loadFromURL with its Maps URL instead.`
        );
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const url = getTileUrl
          ? getTileUrl(x, y)
          : `https://geo0.ggpht.com/cbk?cb_client=maps_sv.tactile&authuser=0&hl=en&panoid=${id}&output=tile&x=${x}&y=${y}&zoom=${zoom}&nbt&fover=2`;

        this.stitcher.addTileTask({
          url,
          x: x * tileSize.width,
          y: y * tileSize.height,
          w: tileSize.width,
          h: tileSize.height,
        });
      }
    }

    return this.stitcher.process();
  }
}

// Exported so tests can check the tables against what Google actually reports.
export { GoogleStreetViewLoader, GRID_26, GRID_32 };
