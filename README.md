# PanomNom.js

Panorama fetching tools for JavaScript

PanomNom.js is a spiritual successor to [GSVPano.js](https://github.com/spite/GSVPano.js/). This new version is updated to use ES6 features like modules and async/await.

Current supported sources

- Google Street View panoramas
- Google PhotoSpheres
- Google Street View panorama depth and planes info

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
> A 429 carrying a short `Retry-After` is waited out; anything longer fails immediately, because retrying into a limiter is what deepens it.

> **Heads up:** this library reads undocumented Google endpoints that are not part of any public API. They can change or disappear without notice, coverage varies by panorama, and using them is likely contrary to the Google Maps Platform Terms of Service. Treat it as a toy, not as infrastructure.

### Install

Not published to npm, and deliberately so: this reads undocumented Google
endpoints, and a package on a registry invites people to depend on it as if it
were supported. `package.json` is marked `private` to keep that accidental.

Vendor `build/PanomNom.module.js`, or add the repository as a git dependency.

### How to use

Include the google maps API for the services to resolve metadata. This is needed by `GoogleStreetViewLoader`, `getIdByLocation` and `resolveAddress`; the PhotoSphere and depth loaders do not use it.

```html
<script src="https://maps.google.com/maps/api/js"></script>
```

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

Once the panorama is loaded, `loader.canvas` has the resulting stitched image. A loader can be reused: each `load` clears the canvas and starts a fresh run.

**Note: `getIdByLocation` does not only return Street View panoramas.** It can return a photo sphere, in which case the id is a base64 protobuf wrapping the real one and the tiles are served from a different host entirely. `GoogleStreetViewLoader` uses the tile URL the Maps API reports, so this usually just works; where it can't, it says so rather than silently fetching nothing. `decodePanoId` will tell you what an id actually refers to:

```javascript
import { decodePanoId } from "./PanomNom.module.js";

decodePanoId("CAoSF0NJSE0wb2dLRUlDQWdJREU4YjdNMndF");
// { kind: "photo-sphere", id: "CIHM0ogKEICAgIDE8b7M2wE" }
decodePanoId("kCisB_W6mNaYBgdxg0AX8A"); // null - a plain id
```

You can use `loader.onProgress` to track loading progress:

```javascript
loader.onProgress((p) => {
  console.log(`Loaded ${p.toFixed(0)}%`);
});
```

# GooglePhotoSphereLoader

Same shape as `GoogleStreetViewLoader`, for PhotoSphere ids (they look like `AF1QipMKVZBKb5dP2my1FWB2ljCp2vXqiISTzj056YD_`). The available zoom levels vary per photo sphere, so an out-of-range zoom throws rather than producing a blank canvas.

```javascript
import { GooglePhotoSphereLoader } from "./PanomNom.module.js";

const loader = new GooglePhotoSphereLoader();
await loader.load(id, 3);
```

Photo spheres are frequently shot by members of the public, so `loader.metadata` carries `author` and `authorURL` alongside `copyright`. Credit both.

```javascript
const { copyright, author, authorURL } = loader.metadata;
```

### Newer photo spheres need the Maps URL

Photo spheres come in two generations. Older ones (`AF1Qip…` ids) are served from `lh3.ggpht.com/p/<id>` and load from an id alone. Newer ones (`CIHM0…` ids) are served from an opaque `googleusercontent.com` media id that appears **only in the Maps URL** — it is not in the metadata response, so it cannot be looked up from the panorama id. For those, pass the URL:

```javascript
await loader.loadFromURL(mapsURL, 3);
```

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

Not every panorama has depth data. By default a missing or malformed depth map throws; pass `{ fallbackToEmpty: true }` to get an all-sky depth map instead.

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
| `INVALID_ZOOM` | the requested zoom level does not exist for this panorama |

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

Very important: `loader.metadata.copyright` contains the copyright notice for the retrieved images, and `GooglePhotoSphereLoader` additionally exposes `author` / `authorURL`. You should display them somewhere in your page. See `examples/basic/ps-panoid.html` for how.

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

# Examples

Please see the examples folder for proper implementations of each case.

[Street View panorama from id](https://spite.github.io/PanomNom.js/examples/basic/sv-panoid.html)  
[Street View panorama from lat,lng](https://spite.github.io/PanomNom.js/examples/basic/sv-location.html)  
[Street View panorama from URL](https://spite.github.io/PanomNom.js/examples/basic/sv-url.html)  
[Street View depth map](https://spite.github.io/PanomNom.js/examples/basic/sv-depth.html)  
[PhotoSphere from id](https://spite.github.io/PanomNom.js/examples/basic/ps-panoid.html)  
[PhotoSphere from URL](https://spite.github.io/PanomNom.js/examples/basic/ps-url.html)  
[Using the built bundle](https://spite.github.io/PanomNom.js/examples/basic/bundle.html)

A more complete example, with Leaflet map control and more:

[Floating Shiny Knot](https://spite.github.io/FloatingShinyKnot/)

# License

MIT licensed

Copyright (C) 2022 Jaume Sanchez Elias http://twitter.com/thespite

http://www.clicktorelease.com
