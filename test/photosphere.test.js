import { test } from "node:test";
import assert from "node:assert/strict";

import { installDOM, loads } from "./dom-stub.js";

installDOM();

const { GooglePhotoSphereLoader } = await import("../src/GooglePhotoSphereLoader.js");
const { ErrorCodes } = await import("../src/errors.js");

const MEDIA = "https://lh3.googleusercontent.com/gpms-cs-s/MEDIA";

// The parts of a photometa reply the loader reads: size, tile size, pyramid, and media URL.
function photometa({ media = true } = {}) {
  const node = [];
  node[2] = [null, null, [1024, 2048], [[[[256, 512]], [[512, 1024]]], [512, 512]]];
  if (media) node[17] = [[`${MEDIA}=w0-h0-k-no`]];
  return [null, [node]];
}

function stubPhotometa(reply) {
  const tileFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!url.includes("/photometa/")) return tileFetch(url, options);
    loads.push(url);
    return { ok: true, status: 200, text: async () => ")]}'\n" + JSON.stringify(reply) };
  };
  return () => (globalThis.fetch = tileFetch);
}

test("a newer photo sphere loads from its id, with tiles from the media photometa reports", async () => {
  const restore = stubPhotometa(photometa());
  loads.length = 0;
  await new GooglePhotoSphereLoader().load("CIHM0ogKEICAgIDCqvKvNg", 1);
  restore();
  const tiles = loads.filter((u) => !u.includes("/photometa/"));
  assert.deepEqual(tiles, [`${MEDIA}=x0-y0-z1`, `${MEDIA}=x1-y0-z1`]);
});

test("a newer photo sphere without a media URL fails before fetching tiles", async () => {
  const restore = stubPhotometa(photometa({ media: false }));
  loads.length = 0;
  await assert.rejects(
    new GooglePhotoSphereLoader().load("CIHM0ogKEICAgIDCqvKvNg", 1),
    (e) => e.code === ErrorCodes.NEEDS_MAPS_URL
  );
  restore();
  assert.ok(loads.every((u) => u.includes("/photometa/")));
});
