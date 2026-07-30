// These live in their own file on purpose. utils.js caches the StreetViewService
// in module state, so the first google.maps installed wins for the rest of the
// process, and node --test isolates each file in its own process.
//
// Within the file there is a single service whose metadata varies per panorama,
// which is also how the real API behaves: getTileUrl belongs to a given
// panorama's tile data, not to the service.
import { test } from "node:test";
import assert from "node:assert/strict";

import { installDOM, loads } from "./dom-stub.js";

// Returned by getIdByLocation: a base64 protobuf wrapping a photo sphere id.
const WRAPPED_PHOTO_SPHERE = "CAoSF0NJSE0wb2dLRUlDQWdJREU4YjdNMndF";
const NO_TILE_URL_PANO = "legacyPanoWithoutGetTileUrl";

const asked = [];
// The service is constructed once and cached inside utils.js, so vary its
// behaviour through a flag rather than trying to swap the service out.
let provideTileUrl = true;

function installStubImage() {
  installDOM();
  globalThis.Image = class {
    constructor() {
      this._l = {};
      this.naturalWidth = 512;
      this.naturalHeight = 512;
    }
    addEventListener(t, f) {
      (this._l[t] ||= []).push(f);
    }
    removeEventListener(t, f) {
      this._l[t] = (this._l[t] || []).filter((x) => x !== f);
    }
    set src(u) {
      if (!u) return;
      loads.push(u);
      queueMicrotask(() => this._l.load?.forEach((f) => f()));
    }
    get src() {
      return "";
    }
  };
}

installStubImage();

globalThis.google = {
  maps: {
    StreetViewService: class {
      async getPanorama({ pano }) {
        const tiles = {
          worldSize: { width: 13312, height: 6656 },
          tileSize: { width: 512, height: 512 },
        };
        // Older responses carry no getTileUrl; newer ones do.
        if (provideTileUrl && pano !== NO_TILE_URL_PANO) {
          tiles.getTileUrl = (p, zoom, x, y) => {
            asked.push({ pano: p, zoom, x, y });
            return `https://lh3.googleusercontent.com/stub=x${x}-y${y}-z${zoom}`;
          };
        }
        return { data: { tiles } };
      }
    },
  },
};

const { GoogleStreetViewLoader } = await import(
  "../src/GoogleStreetViewLoader.js"
);
const { ErrorCodes } = await import("../src/errors.js");

test("prefers the tile URL the Maps API reports", async () => {
  // getPanorama can return a photo sphere, whose tiles are not on the Street
  // View host. The Maps API knows where they are, so ask rather than guess.
  asked.length = 0;
  loads.length = 0;

  await new GoogleStreetViewLoader().load(WRAPPED_PHOTO_SPHERE, 1);

  assert.equal(asked.length, 2, "should have asked the Maps API for each tile");
  assert.deepEqual(asked[0], { pano: WRAPPED_PHOTO_SPHERE, zoom: 1, x: 0, y: 0 });
  assert.ok(loads.length > 0);
  assert.ok(
    loads.every((u) => !u.includes("geo0.ggpht.com")),
    "must not fall back to the hardcoded Street View host"
  );
});

test("falls back to the Street View host for a plain id", async () => {
  loads.length = 0;

  await new GoogleStreetViewLoader().load(NO_TILE_URL_PANO, 1);

  assert.ok(loads.length > 0);
  assert.ok(
    loads.every((u) => u.includes("geo0.ggpht.com")),
    "a plain Street View id with no getTileUrl should use the legacy endpoint"
  );
});

test("explains a wrapped photo sphere id it cannot fetch", async () => {
  // No getTileUrl, and the id unwraps to a photo sphere, so the Street View
  // tile endpoint would 400 with nothing to explain why.
  provideTileUrl = false;
  try {
    await assert.rejects(
      new GoogleStreetViewLoader().load(WRAPPED_PHOTO_SPHERE, 1),
      (e) => {
        assert.equal(e.code, ErrorCodes.BAD_METADATA);
        assert.match(e.message, /photo-sphere/);
        assert.match(e.message, /CIHM0ogKEICAgIDE8b7M2wE/);
        return true;
      }
    );
  } finally {
    provideTileUrl = true;
  }
});
