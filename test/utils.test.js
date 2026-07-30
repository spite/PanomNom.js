import { test } from "node:test";
import assert from "node:assert/strict";

import { getIdFromURL, parsePanoURL, decodePanoId } from "../src/utils.js";
import { ErrorCodes } from "../src/errors.js";

const PANO = "kCisB_W6mNaYBgdxg0AX8A";

test("extracts the id from a modern /maps/@ URL", () => {
  assert.equal(
    getIdFromURL(
      `https://www.google.com/maps/@51.5316182,-0.125108,3a,75y,158.01h,90t/data=!3m6!1e1!3m4!1s${PANO}!2e0!7i16384!8i8192`
    ),
    PANO
  );
});

test("extracts the id from a legacy ?panoid= URL", () => {
  assert.equal(
    getIdFromURL(
      `https://maps.google.com/?ll=40.741352,-73.986096&cbll=40.741825,-73.986315&panoid=${PANO}&cbp=12,208.53,,0,6.03`
    ),
    PANO
  );
});

test("finds panoid in an embedded query string, not just the first one", () => {
  assert.equal(
    getIdFromURL(
      `https://www.google.com/maps/@51.5,-0.12,3a/data=!4m2!6shttps%3A%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fpanoid%3D${PANO}%26w%3D96`
    ),
    PANO
  );
});

test("handles an id as the final token with no trailing separator", () => {
  // Previously returned "" because substr(pos, -1) is the empty string.
  assert.equal(getIdFromURL(`https://www.google.com/maps/data=!3m3!1s${PANO}`), PANO);
});

test("throws NO_PANO_ID when 'panoid' appears but is not a parameter", () => {
  // Previously returned null and failed later inside load().
  assert.throws(
    () => getIdFromURL("https://www.google.com/maps/panoid/browse?q=london"),
    (e) => {
      assert.equal(e.code, ErrorCodes.NO_PANO_ID);
      return true;
    }
  );
});

test("throws NO_PANO_ID when there is no id at all", () => {
  assert.throws(
    () => getIdFromURL("https://www.google.com/maps"),
    (e) => e.code === ErrorCodes.NO_PANO_ID
  );
});

// --- parsePanoURL ----------------------------------------------------------

const MODERN_PS_URL =
  "https://www.google.com/maps/@51.5315636,-0.1242444,3a,75y,84.63h,92.54t/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgIDq8-jQcQ!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FAFP8RcOVd8xgZHX-4XSukqxYyKKUpd3gSN0z0Ryz5vKUrXviCZnyJI4BgBIHNiVnSKYi2zoz0GxLo8d2Xp3O-y9d1PeknLKmlSwyyzJqZ5SyCppyI9Oa-tuIhvYrFMe7dIkUaySn0WIn%3Dw900-h600-k-no-pi-2.5440472982150624-ya357.625233030754-ro0-fo100!7i12288!8i3982?entry=ttu&g_ep=EgoyMDI2MDcyNy4wIKXMDSoASAFQAw%3D%3D";

const SV_URL = `https://www.google.com/maps/@51.5316182,-0.125108,3a,75y,158.01h,90t/data=!3m6!1e1!3m4!1s${PANO}!2e0!7i16384!8i8192`;

test("parsePanoURL reads id, kind and tile base from a photo sphere URL", () => {
  const { id, kind, tileBase } = parsePanoURL(MODERN_PS_URL);

  assert.equal(id, "CIHM0ogKEICAgIDq8-jQcQ");
  assert.equal(kind, "photo-sphere");
  // The tile base must be the !6s URL with its sizing suffix stripped.
  assert.ok(tileBase.startsWith("https://lh3.googleusercontent.com/gpms-cs-s/"));
  assert.ok(!tileBase.includes("="), "sizing suffix should be removed");
});

test("parsePanoURL marks a street view URL as such and has no tile base", () => {
  const { id, kind, tileBase } = parsePanoURL(SV_URL);

  assert.equal(id, PANO);
  assert.equal(kind, "street-view");
  assert.equal(tileBase, null);
});

test("parsePanoURL throws NO_PANO_ID when there is no !1s token", () => {
  assert.throws(
    () => parsePanoURL("https://www.google.com/maps"),
    (e) => e.code === ErrorCodes.NO_PANO_ID
  );
});

test("getIdFromURL still handles the modern photo sphere URL", () => {
  assert.equal(getIdFromURL(MODERN_PS_URL), "CIHM0ogKEICAgIDq8-jQcQ");
});

// A /maps/place/ URL carries a second !1s holding the place's feature id.
const PLACE_URL =
  "https://www.google.com/maps/place/Barcelona,+Spain/@41.3817817,2.1716902,3a,75y,335.81h,90t/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgICE_fG1swE!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FAFP8RcMqHZfkrEVC2IyUwrDjdVTl_U0zy8n1n9BGPoZxxxWFkWWPLPz2S-sdLsgR52zPIRG6s5V0lFbEEG5pEAko2esjXR5mK-tuBCurNIe8Fc6mA09OhMqGuS9332xOhbiYnsip7Xfz9A%3Dw900-h600-k-no-pi0-ya146.14983841966531-ro0-fo100!7i9764!8i4882!4m6!3m5!1s0x12a49816718e30e5:0x44b0fb3d4f47660a!8m2!3d41.3874374!4d2.1686496!16zL20vMDFmNjI?entry=ttu&g_ep=EgoyMDI2MDcyNy4wIKXMDSoASAFQAw%3D%3D";

test("place URL yields the pano id, not the place feature id", () => {
  const { id, kind } = parsePanoURL(PLACE_URL);
  assert.equal(id, "CIHM0ogKEICAgICE_fG1swE");
  assert.equal(kind, "photo-sphere");
  assert.equal(getIdFromURL(PLACE_URL), "CIHM0ogKEICAgICE_fG1swE");
});

test("pano id wins even when the place block comes first", () => {
  // Google orders these blocks by URL type, so don't rely on the pano being
  // first: pair !1s with the !2e that follows it.
  const reordered =
    "https://www.google.com/maps/place/Barcelona/data=!4m6!3m5!1s0x12a49816718e30e5:0x44b0fb3d4f47660a!8m2!3d41.38!4d2.17!3m6!1sCIHM0ogKEICAgICE_fG1swE!2e10!3e11!7i9764!8i4882";

  assert.equal(parsePanoURL(reordered).id, "CIHM0ogKEICAgICE_fG1swE");
  assert.equal(getIdFromURL(reordered), "CIHM0ogKEICAgICE_fG1swE");
});

// --- decodePanoId ----------------------------------------------------------

test("decodePanoId unwraps a protobuf-wrapped photo sphere id", () => {
  // Returned by getIdByLocation, which does not only yield Street View panos.
  assert.deepEqual(decodePanoId("CAoSF0NJSE0wb2dLRUlDQWdJREU4YjdNMndF"), {
    kind: "photo-sphere",
    id: "CIHM0ogKEICAgIDE8b7M2wE",
  });
});

test("decodePanoId returns null for ordinary ids", () => {
  // These must not be mistaken for wrappers, or every load would misreport.
  for (const id of [
    PANO,
    "CIHM0ogKEICAgIDq8-jQcQ",
    "AF1QipMKVZBKb5dP2my1FWB2ljCp2vXqiISTzj056YD_",
    "4avA1iH-YV3U2s2rK12tqA",
    "not a valid id at all",
  ]) {
    assert.equal(decodePanoId(id), null, id);
  }
});
