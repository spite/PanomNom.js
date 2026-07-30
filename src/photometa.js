import { PanomNomError, ErrorCodes } from "./errors.js";

// Undocumented endpoint used by Google Maps itself. The `pb` value is a
// serialised protobuf; the only part that varies between the panorama types is
// the entity kind in `!3m3!1m2!1e<KIND>!2s<ID>`.
const ENTITY_STREET_VIEW = 2;
const ENTITY_PHOTO_SPHERE = 10;

function photometaURL(id, kind) {
  return (
    `https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=uk&pb=` +
    `!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2suk` +
    `!3m3!1m2!1e${kind}!2s${id}` +
    `!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2` +
    `!6m1!1e1!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2` +
    `!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3` +
    `!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3`
  );
}

async function fetchPhotometa(id, kind) {
  const res = await fetch(photometaURL(id, kind));
  if (!res.ok) {
    throw new PanomNomError(
      ErrorCodes.BAD_METADATA,
      `photometa request for "${id}" failed with ${res.status}`
    );
  }
  const text = await res.text();
  // The response is prefixed with an anti-JSON-hijacking guard: )]}'
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

// The response is a deeply nested untyped array. Walking it with a named path
// means a shape change reports where it broke instead of throwing a bare
// "cannot read property of undefined".
function pick(root, path, id) {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    if (node === null || node === undefined) {
      throw new PanomNomError(
        ErrorCodes.BAD_METADATA,
        `Unexpected photometa shape for "${id}": no value at [${path
          .slice(0, i)
          .join("][")}]`
      );
    }
    node = node[path[i]];
  }
  if (node === null || node === undefined) {
    throw new PanomNomError(
      ErrorCodes.BAD_METADATA,
      `Unexpected photometa shape for "${id}": no value at [${path.join("][")}]`
    );
  }
  return node;
}

// Same walk as pick(), but for values that are nice to have rather than
// required. Missing attribution should not fail a panorama load.
function tryPick(root, path) {
  let node = root;
  for (const key of path) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  return node ?? undefined;
}

// Photo spheres are frequently shot by members of the public, so the author is
// part of the required attribution, not just decoration.
function extractAttribution(info) {
  return {
    copyright: tryPick(info, [1, 0, 4, 0, 0, 0, 0]),
    author: tryPick(info, [1, 0, 4, 1, 0, 0, 0]),
    authorURL: tryPick(info, [1, 0, 4, 1, 0, 1]),
  };
}

// The same tile metadata the Maps JS API reports, read straight from photometa.
//
// This is what makes Street View usable without the Maps API at all — needed
// in a Chrome MV3 extension, where loading Google's script is forbidden as
// remote code, and anywhere you would rather not pull in the whole Maps SDK.
// The one thing it cannot supply is getTileUrl, so callers fall back to
// building tile URLs themselves.
async function getStreetViewMetadata(id) {
  const info = await fetchPhotometa(id, ENTITY_STREET_VIEW);
  const size = pick(info, [1, 0, 2, 2], id);
  const tile = pick(info, [1, 0, 2, 3, 1], id);

  return {
    tiles: {
      // photometa reports [height, width].
      worldSize: { width: size[1], height: size[0] },
      tileSize: { width: tile[1], height: tile[0] },
    },
    ...extractAttribution(info),
  };
}

export {
  fetchPhotometa,
  pick,
  tryPick,
  extractAttribution,
  getStreetViewMetadata,
  ENTITY_STREET_VIEW,
  ENTITY_PHOTO_SPHERE,
};
