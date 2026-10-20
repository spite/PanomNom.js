# PanomNom.js

Panorama fetching tools for JavaScript

PanomNom.js is a spiritual successor to [GSVPano.js](https://github.com/spite/GSVPano.js/). This new version is updated to use ES6 features like modules and async/await.

Current supported sources

- Google Street View panoramas
- Google PhotoSpheres
- Google Street View panorama depth and planes info

#### Demos ####

All of them are listed in the **[examples page](https://spite.github.io/PanomNom.js/examples/basic/)**. Each shows the panorama in 360°, flat, or as a download.

- **[Street View panorama from id](https://spite.github.io/PanomNom.js/examples/basic/sv-panoid.html)**
- **[Street View panorama from lat,lng](https://spite.github.io/PanomNom.js/examples/basic/sv-location.html)**
- **[Street View panorama from URL](https://spite.github.io/PanomNom.js/examples/basic/sv-url.html)**
- **[Street View depth map](https://spite.github.io/PanomNom.js/examples/basic/sv-depth.html)**
- **[PhotoSphere from id](https://spite.github.io/PanomNom.js/examples/basic/ps-panoid.html)**
- **[PhotoSphere from URL](https://spite.github.io/PanomNom.js/examples/basic/ps-url.html)**
- **[Using the built bundle](https://spite.github.io/PanomNom.js/examples/basic/bundle.html)**
- **[Floating Shiny Knot](https://spite.github.io/FloatingShinyKnot/)**: a more complete example, with Leaflet map control and more

#### 2026 update ####
**Disclaimer:** this library started in 2014, and reads undocumented Google endpoints that are not part of any public API. They can change or disappear without notice, coverage varies by panorama, and using them is likely contrary to the Google Maps Platform Terms of Service. Treat it as a toy, not as infrastructure

Google has a supported way to get this imagery now, the [Map Tiles API](https://developers.google.com/maps/documentation/tile/streetview), which serves Street View tiles and metadata with an API key. Use that for anything that has to keep working.

The library has been updated. What changed:

- a panorama that fails doesn't leave the loader hanging, and a loader can be reused or cancelled without mixing two panoramas
- tiles are fetched 6 at a time instead of 50, retried before giving up, and a request that Google throttles is reported as its own error
- the ids that are not Street View panoramas are handled: photo spheres, older and newer, from their id or their Maps URL
- tiles are fetched without a referrer: `googleusercontent.com` answers 429 to any page on localhost
- the metadata, the parsing of URLs and the decoding of the depth maps were fixed
- errors have a code to tell them apart
- Street View panoramas can load without the Maps JavaScript API
- `getIdByLocation` returns official Google outdoor panoramas by default, and takes `radius` and `sources` options
- Street View tiles are requested as the `apiv3` client, which also serves headless browsers
- there's a build, a test suite and CI, and the examples work again, with a 360° viewer, a map to pick locations and a 3D view of the depth
- it's not on npm, on purpose

> **Rate limits:** Google limits how fast a single client may pull tiles. Loaders fetch 6 at a time by default; if you load several panoramas back to back and start seeing failures, lower it:
>
> ```javascript
> const loader = new GoogleStreetViewLoader({ concurrency: 3 });
> ```
>
> Tiles are fetched rather than loaded through an `<img>`, so a throttled request is reported as its own error rather than being mistaken for a broken tile:
>
> ```javascript
> catch (e) {
>   if (e.code === ErrorCodes.RATE_LIMITED) { /* wait, don't retry */ }
> }
> ```
>
> A 429 carrying a short `Retry-After` is waited out; anything longer fails immediately, because retrying into a limiter is what deepens it. Other 4xx responses fail at once too: a missing or refused tile doesn't change on a retry. Network errors and 5xx are retried.

### Install

Not published to npm, and deliberately so: this reads undocumented Google
endpoints, and a package on a registry invites people to depend on it as if it
were supported. `package.json` is marked `private` to keep that accidental.

Vendor `build/PanomNom.module.js`, or add the repository as a git dependency.

### How to use

Include the google maps API for the services to resolve metadata. This is needed by `getIdByLocation` and `resolveAddress`, and `GoogleStreetViewLoader` uses it when it's there, to know where the imagery that is not Street View lives; the PhotoSphere and depth loaders do not use it.

```html
<script src="https://maps.google.com/maps/api/js?key=YOUR_API_KEY"></script>
```

Google expects an API key. Without one the script still loads today, with a `NoApiKeys` warning in the console, which is how the examples run.

Include the library or the module. You can import the functions separately from the `/src` folder, or from the `PanomNom.module` file.

There are three loaders: Street View panoramas, PhotoSpheres, and Street View depth.

# GoogleStreetViewLoader

```javascript
import { GoogleStreetViewLoader } from "./PanomNom.module.js";
```

Create a loader:

```javascript
const loader = new GoogleStreetViewLoader();
```

Then `loader.load` takes an id and a zoom level (0-5, default 1) and resolves once the panorama is stitched. There are a few helper methods to retrieve panoIds.

```javascript
/* Load from ID: pano id, zoom 3 */
await loader.load(panoId, 3);

/* Load from location: google.maps.LatLng, zoom default 1 */
import { getIdByLocation } from "./PanomNom.module.js";
const data = await getIdByLocation(pos.lat, pos.lng);
await loader.load(data.data.location.pano);

/* Load from URL: URL from maps.google.com, zoom 2 */
import { getIdFromURL } from "./PanomNom.module.js";
const id = getIdFromURL(url);
await loader.load(id, 2);
```

Once the panorama is loaded, `loader.canvas` has the resulting stitched image. A loader can be reused: each `load` clears the canvas and starts a fresh run. Starting a `load` while another is still running cancels the first, which rejects with `CANCELLED`, so two panoramas never mix on one canvas. `loader.cancel()` stops a load without starting another.

**Note: `getIdByLocation` returns official Google outdoor panoramas by default.** Pass `sources` to widen the search (`["outdoor"]` adds user photo spheres, `["default"]` searches everything) and `radius` to change the 50 m search radius:

```javascript
const data = await getIdByLocation(pos.lat, pos.lng, { radius: 200, sources: ["outdoor"] });
```

A photo sphere comes back as a base64 protobuf wrapping the real id, and its tiles are served from a different host entirely, so unwrap it and load it with `GooglePhotoSphereLoader`. `GoogleStreetViewLoader` uses the tile URL the Maps API reports when there is one; given a photo sphere without one, it says so rather than silently fetching nothing. `decodePanoId` will tell you what an id actually refers to:

```javascript
import { decodePanoId } from "./PanomNom.module.js";

decodePanoId("CAoSF0NJSE0wb2dLRUlDQWdJREU4YjdNMndF");
// { kind: "photo-sphere", id: "CIHM0ogKEICAgIDE8b7M2wE" }
decodePanoId("kCisB_W6mNaYBgdxg0AX8A"); // null - a plain id

const { id } = decodePanoId(data.location.pano);
await new GooglePhotoSphereLoader().load(id, 3);
```

You can use `loader.onProgress` to track loading progress:

```javascript
loader.onProgress((p) => {
  console.log(`Loaded ${p.toFixed(0)}%`);
});
```

# GooglePhotoSphereLoader

Same shape as `GoogleStreetViewLoader`, for PhotoSphere ids (they look like `AF1QipMKVZBKb5dP2my1FWB2ljCp2vXqiISTzj056YD_`, or `CIHM0ogKEICAgIDCqvKvNg` for newer ones). The available zoom levels vary per photo sphere, so an out-of-range zoom throws rather than producing a blank canvas.

```javascript
import { GooglePhotoSphereLoader } from "./PanomNom.module.js";

const loader = new GooglePhotoSphereLoader();
await loader.load(id, 3);
```

Photo spheres are frequently shot by members of the public, so `loader.metadata` carries `author` and `authorURL` alongside `copyright`. Credit both.

```javascript
const { copyright, author, authorURL } = loader.metadata;
```

### Newer photo spheres

Photo spheres come in two generations. Older ones (`AF1Qip…` ids) are served from `lh3.ggpht.com/p/<id>`. Newer ones (`CIHM0…` ids) are served from an opaque `googleusercontent.com` media id. The loader asks photometa for it (the `!1e17` field Google Maps requests too), so both generations load from the id alone. A Maps URL works as well:

```javascript
await loader.loadFromURL(mapsURL, 3);
```

If the URL carries the media id (its `!6s…` part, which Maps adds once the photo sphere has loaded), that one is used. It stops working after a while, and its tiles then fail with HTTP 403, so don't save one: the id is the stable reference.

`parsePanoURL` exposes the pieces if you want them separately. `kind` is `"photo-sphere"` or `"street-view"`, which is a more reliable check than guessing from the id's shape:

```javascript
import { parsePanoURL } from "./PanomNom.module.js";

const { id, kind, tileBase } = parsePanoURL(mapsURL);
await loader.load(id, 3, { tileBase });
```

# GoogleStreetViewDepthLoader

Returns `{ width, height, depthMap }`, where `depthMap` is a `Float32Array` of distances in metres. Pixels that belong to no plane — the sky — are `Infinity`.

```javascript
import { GoogleStreetViewDepthLoader } from "./PanomNom.module.js";

const loader = new GoogleStreetViewDepthLoader();
const { width, height, depthMap } = await loader.load(panoId);
```

Not every panorama has depth data, and Google sends none to headless browsers. By default a missing or malformed depth map throws `BAD_METADATA`; pass `{ fallbackToEmpty: true }` to get an all-sky depth map instead.

```javascript
const loader = new GoogleStreetViewDepthLoader({ fallbackToEmpty: true });
```

# Errors

Everything rejects with a `PanomNomError` carrying a `code`, so you can branch on the cause without matching on message strings:

| code | meaning |
| --- | --- |
| `NO_PANO_ID` | no panorama id could be found in the given URL |
| `ZERO_RESULTS` | Google has no panorama for that id or location |
| `NO_IMAGE` | a tile failed to load; the rest of the run is cancelled |
| `RATE_LIMITED` | Google is throttling tile requests (HTTP 429/503) |
| `BAD_METADATA` | the metadata response was not in the expected shape |
| `NETWORK` | a metadata request never reached Google: offline, blocked, or refused by CORS |
| `CANCELLED` | the load was superseded by another one on the same loader, or `cancel()` was called |
| `INVALID_ZOOM` | the requested zoom level does not exist for this panorama |
| `NEEDS_MAPS_URL` | a newer photo sphere whose media URL photometa did not report; load it from its Maps URL |

`PanomNomError` and an `ErrorCodes` map are both exported, so you don't have to hardcode the strings:

```javascript
import { ErrorCodes } from "./PanomNom.module.js";

try {
  await loader.load(id, 3);
} catch (e) {
  if (e.code === ErrorCodes.NO_IMAGE) {
    // ...
  }
}
```

# About copyright notice

Very important: `loader.metadata.copyright` contains the copyright notice for the retrieved images, and `GooglePhotoSphereLoader` additionally exposes `author` / `authorURL`. You should display them somewhere in your page. See [examples/basic/ps-panoid.html](examples/basic/ps-panoid.html) for how.

# Development

```bash
npm install
npm run check   # syntax-check every source file
npm test        # run the test suite
npm run build   # regenerate build/
```

The suite also contains integration tests that hit the live Google endpoints. They are skipped by default, since they fail whenever Google changes something — which is the point of having them:

```bash
PANOMNOM_NETWORK=1 npm test
```

# License

MIT licensed

Copyright (C) 2022 Jaume Sanchez Elias https://twitter.com/thespite

https://www.clicktorelease.com
