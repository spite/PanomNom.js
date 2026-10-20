// Integration tests against the live Google endpoints. Skipped by default
// because they need network and can break when Google changes something — which
// is exactly what they are for. Run with:
//
//   PANOMNOM_NETWORK=1 npm test
//
import { test } from "node:test";
import assert from "node:assert/strict";

import { installDOM, loads, FakeCanvas } from "./dom-stub.js";

globalThis.__realFetch = globalThis.fetch;

const online = process.env.PANOMNOM_NETWORK === "1";
const opts = { skip: online ? false : "set PANOMNOM_NETWORK=1 to run" };

const SV_PANO = "kCisB_W6mNaYBgdxg0AX8A";
const PHOTO_SPHERE = "AF1QipMKVZBKb5dP2my1FWB2ljCp2vXqiISTzj056YD_";
// A panorama Google still resolves but serves no imagery or depth for.
const STUB_PANO = "KGh2_8m7l_ikrgaYrAAFeA";
// A short-form Street View id. Ids in this shape are often mistaken for photo
// sphere ids, which is why it is tested against both loaders.
const SHORT_FORM_PANO = "4avA1iH-YV3U2s2rK12tqA";
// Google filters some tile requests by user agent; headless Chrome is the one capture tools send.
const HEADLESS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36";

// Fetches tiles for real, but records them so tests can assert on the grid.
function installFetchingImage() {
  installDOM();
  const failures = [];
  // Real network, real status codes. Only decoding is stubbed, since node has
  // no createImageBitmap and the pixels are not what these tests check.
  const realFetch = globalThis.__realFetch;
  globalThis.fetch = async (url, init) => {
    if (!url.includes("/maps/photometa/")) loads.push(url);
    const res = await realFetch(url, init);
    if (!res.ok) failures.push(`${res.status} ${url}`);
    return res;
  };
  globalThis.createImageBitmap = async () => ({
    width: 512,
    height: 512,
    close() {},
  });
  return failures;
}

// Tile dimensions normally come from the Maps JS API. Stub just that from the
// photometa response, so the tile grid and stitching still run against real
// imagery without needing an API key.
async function stubMapsFromPhotometa(id) {
  const { fetchPhotometa, pick, ENTITY_STREET_VIEW } = await import(
    "../src/photometa.js"
  );
  const info = await fetchPhotometa(id, ENTITY_STREET_VIEW);
  const size = pick(info, [1, 0, 2, 2], id);
  const tileSize = pick(info, [1, 0, 2, 3, 1], id);
  const pyramid = pick(info, [1, 0, 2, 3, 0], id);

  globalThis.google = {
    maps: {
      StreetViewService: class {
        async getPanorama() {
          return {
            data: {
              copyright: "© Google",
              tiles: {
                worldSize: { width: size[1], height: size[0] },
                tileSize: { width: tileSize[1], height: tileSize[0] },
              },
            },
          };
        }
      },
    },
  };

  return {
    worldSize: { width: size[1], height: size[0] },
    // Google reports each level as [height, width].
    widths: pyramid.map((level) => level[0][1]),
  };
}

test("depth loader decodes a live panorama", opts, async () => {
  const { GoogleStreetViewDepthLoader, NO_PLANE } = await import(
    "../src/GoogleStreetViewDepthLoader.js"
  );

  const { width, height, depthMap } = await new GoogleStreetViewDepthLoader().load(
    SV_PANO
  );

  assert.equal(depthMap.length, width * height);

  const finite = depthMap.filter(Number.isFinite);
  assert.ok(finite.length > 0, "expected some finite depths");
  assert.ok(
    Math.min(...finite) > 0,
    "depths must be positive distances in metres"
  );
  assert.ok(
    depthMap.some((d) => d === NO_PLANE),
    "expected sky pixels to be Infinity"
  );
});

test("depth loader reports a typed error for a panorama with no depth", opts, async () => {
  const { GoogleStreetViewDepthLoader } = await import(
    "../src/GoogleStreetViewDepthLoader.js"
  );
  const { ErrorCodes } = await import("../src/errors.js");

  await assert.rejects(
    new GoogleStreetViewDepthLoader().load(STUB_PANO),
    (e) => {
      assert.equal(e.code, ErrorCodes.BAD_METADATA);
      assert.match(e.message, /No depth map/);
      return true;
    }
  );
});

test("depth loader honours fallbackToEmpty", opts, async () => {
  const { GoogleStreetViewDepthLoader, NO_PLANE } = await import(
    "../src/GoogleStreetViewDepthLoader.js"
  );

  const res = await new GoogleStreetViewDepthLoader({
    fallbackToEmpty: true,
  }).load(STUB_PANO);

  assert.ok(res.depthMap.every((d) => d === NO_PLANE));
});

test("photo sphere loader needs no google.maps and fetches a full grid", opts, async () => {
  const failures = installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  const loader = new GooglePhotoSphereLoader();
  loads.length = 0;
  await loader.load(PHOTO_SPHERE, 2);

  assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
  assert.equal(loads.length, 8, "zoom 2 should be a 4x2 grid");
  assert.ok(loader.canvas.width > 0 && loader.canvas.height > 0);
});

test("photo sphere loader exposes attribution", opts, async () => {
  installFetchingImage();
  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  const loader = new GooglePhotoSphereLoader();
  await loader.load(PHOTO_SPHERE, 0);

  // The README tells users to display this, so it has to actually be there.
  assert.equal(typeof loader.metadata.copyright, "string");
  assert.ok(loader.metadata.copyright.length > 0);
  assert.equal(typeof loader.metadata.author, "string");
  assert.ok(loader.metadata.author.length > 0);
});

test("photo sphere loader rejects a zoom the pyramid doesn't have", opts, async () => {
  installFetchingImage();
  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );
  const { ErrorCodes } = await import("../src/errors.js");

  await assert.rejects(
    new GooglePhotoSphereLoader().load(PHOTO_SPHERE, 99),
    (e) => e.code === ErrorCodes.INVALID_ZOOM
  );
});

test("street view loader stitches a live tile grid", opts, async () => {
  const failures = installFetchingImage();
  await stubMapsFromPhotometa(SV_PANO);

  const { GoogleStreetViewLoader } = await import(
    "../src/GoogleStreetViewLoader.js"
  );

  const loader = new GoogleStreetViewLoader();
  let progress = 0;
  loader.onProgress((p) => (progress = p));

  for (const [zoom, expected] of [
    [0, 1],
    [1, 2],
    [2, 8],
  ]) {
    loads.length = 0;
    await loader.load(SV_PANO, zoom);
    assert.equal(loads.length, expected, `zoom ${zoom} tile count`);
    assert.equal(progress, 100, `zoom ${zoom} should finish at 100%`);
    assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
  }
});

test("street view tiles are served to headless browsers", opts, async () => {
  const failures = installFetchingImage();
  await stubMapsFromPhotometa(SV_PANO);

  const fetchingImage = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    fetchingImage(url, { ...init, headers: { "user-agent": HEADLESS_UA } });

  const { GoogleStreetViewLoader } = await import(
    "../src/GoogleStreetViewLoader.js"
  );

  try {
    await new GoogleStreetViewLoader().load(SV_PANO, 1);
  } finally {
    globalThis.fetch = fetchingImage;
  }
  assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
});

test("street view loader rejects an out-of-range zoom", opts, async () => {
  installFetchingImage();
  const { GoogleStreetViewLoader } = await import(
    "../src/GoogleStreetViewLoader.js"
  );
  const { ErrorCodes } = await import("../src/errors.js");

  globalThis.google = {
    maps: {
      StreetViewService: class {
        async getPanorama() {
          return {
            data: {
              tiles: {
                worldSize: { width: 13312, height: 6656 },
                tileSize: { width: 512, height: 512 },
              },
            },
          };
        }
      },
    },
  };

  await assert.rejects(
    new GoogleStreetViewLoader().load(SV_PANO, 6),
    (e) => e.code === ErrorCodes.INVALID_ZOOM
  );
});

// --- 4avA1iH-YV3U2s2rK12tqA ------------------------------------------------
//
// A short-form id that looks like a photo sphere id but is a Street View
// panorama: lh3.ggpht.com/p/<id> returns 400 for it, geo0.ggpht.com serves
// tiles, and photometa only has data under the Street View entity kind.

test("short-form pano is rejected by the photo sphere loader", opts, async () => {
  installFetchingImage();
  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );
  const { ErrorCodes } = await import("../src/errors.js");

  // The failure has to name where the metadata ran out, not throw a bare
  // TypeError from indexing into undefined.
  await assert.rejects(
    new GooglePhotoSphereLoader().load(SHORT_FORM_PANO, 0),
    (e) => {
      assert.equal(e.code, ErrorCodes.BAD_METADATA);
      assert.match(e.message, new RegExp(SHORT_FORM_PANO));
      assert.match(e.message, /no value at/);
      return true;
    }
  );
});

test("short-form pano loads through the street view loader", opts, async () => {
  const failures = installFetchingImage();
  const { worldSize } = await stubMapsFromPhotometa(SHORT_FORM_PANO);

  const { GoogleStreetViewLoader } = await import(
    "../src/GoogleStreetViewLoader.js"
  );

  const loader = new GoogleStreetViewLoader();
  let progress = 0;
  loader.onProgress((p) => (progress = p));

  // 13312 / 512 === 26, so this panorama exercises the cropped tile grid
  // rather than the clean 32-wide one.
  assert.equal(worldSize.width / 512, 26);

  for (const [zoom, expected] of [
    [0, 1],
    [1, 2],
    [2, 8],
  ]) {
    loads.length = 0;
    await loader.load(SHORT_FORM_PANO, zoom);
    assert.equal(loads.length, expected, `zoom ${zoom} tile count`);
    assert.equal(progress, 100, `zoom ${zoom} should finish at 100%`);
    assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
    assert.ok(
      loads.every((u) => u.includes(`panoid=${SHORT_FORM_PANO}`)),
      "every tile url should target the requested panorama"
    );
  }
});

test("hardcoded 26-wide grid matches the pyramid Google reports", opts, async () => {
  // GoogleStreetViewLoader picks canvas sizes from a table copied out of
  // Street View years ago. Compare the table itself against live metadata, so
  // this fails if either the table or Google's pyramid changes.
  const { widths, worldSize } = await stubMapsFromPhotometa(SHORT_FORM_PANO);
  const { GRID_26 } = await import("../src/GoogleStreetViewLoader.js");

  assert.equal(worldSize.width / 512, 26, "expected the cropped grid");
  assert.deepEqual(GRID_26.widths, widths);
  assert.equal(
    GRID_26.levels.at(-1),
    worldSize.width / 512,
    "top level should be the full tile count"
  );
});

// A photo sphere whose tiles come from an opaque googleusercontent media id
// rather than lh3.ggpht.com/p/<id>, taken here from the !6s part of its Maps URL.
// Media ids stop working after a while: when these tiles 403, reopen each link in Maps and copy the new one.
const MODERN_PS_URL =
  "https://www.google.com/maps/@51.5315636,-0.1242444,3a,75y,84.63h,92.54t/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgIDq8-jQcQ!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FAM4Q-U_-1wk9FGVbKKFdS4yHyuHQMss9KMFfiz8_RdYJRK6jQCl_plkjdhrDKR2QX623xiyFCRy4xQFTnzHw9uAUtppb4vej-zewVFwFZ8jPM1u_WoYAPmkFnA5aTOgmVXG20tET-BwD%3Dw900-h600-k-no-pi-2.5440472982150624-ya357.625233030754-ro0-fo100!7i12288!8i3982?entry=ttu&g_ep=EgoyMDI2MDcyNy4wIKXMDSoASAFQAw%3D%3D";

test("photo sphere with a media-id tile base loads via loadFromURL", opts, async () => {
  const failures = installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  const loader = new GooglePhotoSphereLoader();
  loads.length = 0;
  await loader.loadFromURL(MODERN_PS_URL, 2);

  assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
  assert.ok(
    loads.every((u) => u.startsWith("https://lh3.googleusercontent.com/")),
    "tiles should come from the media id, not lh3.ggpht.com/p/"
  );
  // photometa reports 12288x3982, so zoom 2 is 1536 wide => 3x1 tiles.
  assert.equal(loader.canvas.width, 1536);
  assert.equal(loads.length, 3);
});

test("the same photo sphere loads from its id alone, through photometa's media URL", opts, async () => {
  installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  const loader = new GooglePhotoSphereLoader();
  loads.length = 0;
  await loader.load("CIHM0ogKEICAgIDq8-jQcQ", 0);
  const tiles = loads.filter((u) => !u.includes("/photometa/"));
  assert.equal(tiles.length, 1);
  assert.ok(tiles[0].startsWith("https://lh3.googleusercontent.com/gpms-cs-s/"));
});

// A second media-id photo sphere, and a better grid case than the first: its
// aspect ratio is exactly 2, it has 5 pyramid levels rather than 6, and its top
// level (6720 = 13*512 + 64) ends in a partial column. Under the old
// "grid doubles per zoom" assumption this asked for x15/y7 at z4, both 404.
const MODERN_PS_URL_2 =
  "https://www.google.com/maps/@51.5300392,-0.1258444,3a,75y,97.46h,90t/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgICMxrqUBA!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FAM4Q-U_47E032eng05NpCFPu5a_jrjrSiRiHfpDRXBGrnq9DdVz1TIQoWCAqX9CJj_7wuVfH1BMe8FsEADo5qRZyaECmOEWYwtqoVH-MPYqMgLT-LFPlU4MAXpwFf0S-9WRdkE7DJgs%3Dw900-h600-k-no-pi0-ya272.8867815798158-ro0-fo100!7i6720!8i3360?entry=ttu&g_ep=EgoyMDI2MDcyNy4wIKXMDSoASAFQAw%3D%3D";

test("tile grid is derived from each level's real size, at every zoom", opts, async () => {
  const failures = installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  // [zoom, canvas width, canvas height, tile count]
  const expected = [
    [0, 420, 210, 1],
    [1, 840, 420, 2],
    [2, 1680, 840, 8],
    [3, 3360, 1680, 28],
    [4, 6720, 3360, 98],
  ];

  for (const [zoom, width, height, tiles] of expected) {
    const loader = new GooglePhotoSphereLoader();
    loads.length = 0;
    await loader.loadFromURL(MODERN_PS_URL_2, zoom);

    assert.equal(loader.canvas.width, width, `z${zoom} width`);
    assert.equal(loader.canvas.height, height, `z${zoom} height`);
    assert.equal(loads.length, tiles, `z${zoom} tile count`);
    assert.equal(failures.length, 0, `z${zoom} tiles failed: ${failures.join(", ")}`);
  }
});

test("pyramid depth is read from metadata, not assumed", opts, async () => {
  installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );
  const { ErrorCodes } = await import("../src/errors.js");

  // This sphere has 5 levels; the other modern one has 6.
  await assert.rejects(
    new GooglePhotoSphereLoader().loadFromURL(MODERN_PS_URL_2, 5),
    (e) => {
      assert.equal(e.code, ErrorCodes.INVALID_ZOOM);
      assert.match(e.message, /between 0 and 4/);
      return true;
    }
  );
});

// A /maps/place/ URL. Two things make it a distinct case: it carries a second
// !1s holding Barcelona's place id, and its dimensions (9764x4882) leave both a
// partial last column and a partial last row.
const PLACE_PS_URL =
  "https://www.google.com/maps/place/Barcelona,+Spain/@41.3817817,2.1716902,3a,75y,335.81h,90t/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgICE_fG1swE!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FAM4Q-U_6CcCpBpDjQnuAtJnDlFRs8HuWsu65KBp_jU0NCDJAjn680HbhdZVeNlYCqPcsDzg7ZKkIMpwbEG_UZN1GQdmb5TpqZobFsG_5C_c26yTXoLwzcPHm5NScoWei84zx_yk-_eQIDg%3Dw900-h600-k-no-pi0-ya146.14983841966531-ro0-fo100!7i9764!8i4882!4m6!3m5!1s0x12a49816718e30e5:0x44b0fb3d4f47660a!8m2!3d41.3874374!4d2.1686496!16zL20vMDFmNjI?entry=ttu&g_ep=EgoyMDI2MDcyNy4wIKXMDSoASAFQAw%3D%3D";

test("place URL photo sphere loads, including partial edge tiles", opts, async () => {
  const failures = installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );

  // [zoom, width, height, tiles]
  const expected = [
    [0, 305, 152, 1],
    [2, 1220, 610, 6],
    [3, 2441, 1220, 15],
    // 9764 = 19*512 + 36 and 4882 = 9*512 + 274, so the last column and row are
    // both partial: 20x10, not 19x9.
    [5, 9764, 4882, 200],
  ];

  for (const [zoom, width, height, tiles] of expected) {
    const loader = new GooglePhotoSphereLoader();
    loads.length = 0;
    await loader.loadFromURL(PLACE_PS_URL, zoom);

    assert.equal(loader.canvas.width, width, `z${zoom} width`);
    assert.equal(loader.canvas.height, height, `z${zoom} height`);
    assert.equal(loads.length, tiles, `z${zoom} tile count`);
    assert.equal(failures.length, 0, `z${zoom} failed: ${failures.join(", ")}`);
  }
});

// The media id in the URL and the one photometa reports both reach the tiles.
test("loadFromURL and load(getIdFromURL(url)) both load a modern photo sphere", opts, async () => {
  installFetchingImage();
  delete globalThis.google;

  const { GooglePhotoSphereLoader } = await import(
    "../src/GooglePhotoSphereLoader.js"
  );
  const { getIdFromURL } = await import("../src/utils.js");

  await new GooglePhotoSphereLoader().load(getIdFromURL(PLACE_PS_URL), 0);

  // The same panorama, reached through its URL.
  const loader = new GooglePhotoSphereLoader();
  loads.length = 0;
  await loader.loadFromURL(PLACE_PS_URL, 0);
  assert.equal(loads.length, 1);
  assert.ok(loads[0].startsWith("https://lh3.googleusercontent.com/"));
});

test("street view loads with no Maps API present at all", opts, async () => {
  // A Chrome MV3 extension cannot load the Maps JS API, since that counts as
  // remote code. Metadata has to come from photometa instead.
  const failures = installFetchingImage();
  delete globalThis.google;

  const { GoogleStreetViewLoader } = await import(
    "../src/GoogleStreetViewLoader.js"
  );

  const loader = new GoogleStreetViewLoader();
  loads.length = 0;
  await loader.load(SV_PANO, 1);

  assert.equal(failures.length, 0, `tiles failed: ${failures.join(", ")}`);
  assert.equal(loads.length, 2);
  assert.equal(loader.canvas.width, 832);
  assert.equal(typeof loader.metadata.copyright, "string");
  assert.deepEqual(loader.metadata.tiles.worldSize, {
    width: 13312,
    height: 6656,
  });
});
