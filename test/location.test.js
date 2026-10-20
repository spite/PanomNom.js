// Its own file because utils.js caches the StreetViewService of the first google.maps it sees.
import { test } from "node:test";
import assert from "node:assert/strict";

const requests = [];

globalThis.google = {
  maps: {
    LatLng: class {
      constructor(lat, lng) {
        this.lat = lat;
        this.lng = lng;
      }
    },
    StreetViewService: class {
      async getPanorama(request) {
        requests.push(request);
        return { data: { location: { pano: "stub" } } };
      }
    },
  },
};

const { getIdByLocation } = await import("../src/utils.js");

test("getIdByLocation asks for official outdoor panoramas by default", async () => {
  requests.length = 0;
  await getIdByLocation(40.758, -73.9855);

  assert.deepEqual(requests[0].sources, ["google", "outdoor"]);
  assert.equal(requests[0].radius, 50);
  assert.equal(requests[0].location.lat, 40.758);
  assert.equal(requests[0].location.lng, -73.9855);
});

test("getIdByLocation takes radius and sources", async () => {
  requests.length = 0;
  await getIdByLocation(40.758, -73.9855, { radius: 200, sources: ["outdoor"] });

  assert.equal(requests[0].radius, 200);
  assert.deepEqual(requests[0].sources, ["outdoor"]);
});
