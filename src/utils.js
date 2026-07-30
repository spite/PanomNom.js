import { PanomNomError, ErrorCodes } from "./errors.js";

// Both Google services are lazily constructed and cached: they can only be
// built once google.maps has loaded, which callers can't be forced to sequence.
let GoogleStreetViewService;
let GoogleGeoCoder;

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

// https://developers.google.com/maps/documentation/javascript/reference/street-view-service

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

async function getIdByLocation(lat, lon) {
  const service = getGoogleStreetViewService();
  const latLng = new google.maps.LatLng(lat, lon);
  try {
    return await service.getPanorama({
      location: latLng,
      radius: 50,
      source: "outdoor",
    });
  } catch (e) {
    throw new PanomNomError(
      ErrorCodes.ZERO_RESULTS,
      `No panorama found near ${lat},${lon}`,
      { cause: e }
    );
  }
}

// Google Maps URLs embed other URLs, so the pano id can live in a query string
// that isn't the first one. Check them all.
function getQueryVariable(url, variable) {
  for (const segment of url.split("?").slice(1)) {
    const value = new URLSearchParams(segment).get(variable);
    if (value) return value;
  }
  return null;
}

// Entity kinds used in the "!2e<kind>" token of a Maps data URL.
const ENTITY_KINDS = { 0: "street-view", 10: "photo-sphere" };

// A /maps/place/ URL carries two !1s tokens: the panorama id, and the place's
// feature id (e.g. "0x12a49816718e30e5:0x44b0fb3d4f47660a"). Only the panorama
// is immediately followed by !2e<kind>, so prefer that pairing rather than
// trusting whichever token happens to come first.
function findPanoToken(decoded) {
  const withKind = decoded.match(/!1s([^!]+)!2e(\d+)/);
  if (withKind) return { id: withKind[1], kind: withKind[2] };

  // Older URLs omit !2e entirely.
  const bare = decoded.match(/!1s([^!]+)/);
  return bare ? { id: bare[1], kind: null } : null;
}

// Maps data URLs are a flat list of "!<index><type><value>" tokens:
//
//   !1s<panoId>  the panorama id
//   !2e<kind>    0 for Street View, 10 for a photo sphere
//   !6s<url>     a thumbnail whose base doubles as the tile endpoint
//
// Newer photo spheres are served from an opaque googleusercontent media id that
// appears only in !6s — it cannot be derived from the panorama id, so a URL is
// the only way to reach them.
function parsePanoURL(url) {
  const decoded = decodeURIComponent(url);

  const token = findPanoToken(decoded);
  if (!token) {
    throw new PanomNomError(
      ErrorCodes.NO_PANO_ID,
      `Can't find panorama id in specified URL`
    );
  }

  // Everything after "=" is the sizing suffix, which we replace per tile.
  const tileBase = decoded.match(/!6s(https?:\/\/[^!]+)/)?.[1]?.split("=")[0];

  return {
    id: token.id,
    kind: ENTITY_KINDS[token.kind] ?? null,
    tileBase: tileBase ?? null,
  };
}

function getIdFromURL(url) {
  const decoded = decodeURIComponent(url);

  // https://maps.google.com/?ll=40.741352,-73.986096&cbll=40.741825,-73.986315&panoid=NOMYgwQ4YfVqMJogsbMcrg&cbp=12,208.53,,0,6.03
  const fromQuery = getQueryVariable(decoded, "panoid");
  if (fromQuery) return fromQuery;

  // https://www.google.com/maps/@51.5316182,-0.125108,3a,75y/data=!3m6!1e1!3m4!1skCisB_W6mNaYBgdxg0AX8A!2e0!7i16384!8i8192
  const token = findPanoToken(decoded);
  if (token?.id) return token.id;

  throw new PanomNomError(
    ErrorCodes.NO_PANO_ID,
    `Can't find panorama id in specified URL`
  );
}

// The service getters stay module-private: they are plumbing, and exporting
// them only invited callers to hold a handle they can't do anything useful with.
export {
  getPanoramaById,
  resolveAddress,
  getIdByLocation,
  getIdFromURL,
  parsePanoURL,
};
