import { PanomNomError, ErrorCodes } from "./errors.js";
import { fetchPhotometa, pick, ENTITY_STREET_VIEW } from "./photometa.js";

// Street View ships a coarse depth map as a set of planes plus a per-pixel
// plane index. Pixels that belong to no plane (the sky) are Infinity.
const NO_PLANE = Infinity;

function parseHeader(view) {
  return {
    headerSize: view.getUint8(0),
    numberOfPlanes: view.getUint16(1, true),
    width: view.getUint16(3, true),
    height: view.getUint16(5, true),
    offset: view.getUint16(7, true),
  };
}

function parsePlanes(header, view) {
  const indices = [];
  for (let i = 0; i < header.width * header.height; ++i) {
    indices.push(view.getUint8(header.offset + i));
  }

  const planes = [];
  for (let i = 0; i < header.numberOfPlanes; ++i) {
    const byteOffset = header.offset + header.width * header.height + i * 4 * 4;
    planes.push({
      n: [
        view.getFloat32(byteOffset, true),
        view.getFloat32(byteOffset + 4, true),
        view.getFloat32(byteOffset + 8, true),
      ],
      d: view.getFloat32(byteOffset + 12, true),
    });
  }

  return { planes, indices };
}

function computeDepthMap(header, indices, planes) {
  const w = header.width;
  const h = header.height;

  const depthMap = new Float32Array(w * h);

  const sin_theta = new Float32Array(h);
  const cos_theta = new Float32Array(h);
  const sin_phi = new Float32Array(w);
  const cos_phi = new Float32Array(w);

  for (let y = 0; y < h; ++y) {
    const theta = ((h - y - 0.5) / h) * Math.PI;
    sin_theta[y] = Math.sin(theta);
    cos_theta[y] = Math.cos(theta);
  }
  for (let x = 0; x < w; ++x) {
    const phi = ((w - x - 0.5) / w) * 2 * Math.PI + Math.PI / 2;
    sin_phi[x] = Math.sin(phi);
    cos_phi[x] = Math.cos(phi);
  }

  const v = [0, 0, 0];
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const planeIdx = indices[y * w + x];

      v[0] = sin_theta[y] * cos_phi[x];
      v[1] = sin_theta[y] * sin_phi[x];
      v[2] = cos_theta[y];

      if (planeIdx > 0) {
        const plane = planes[planeIdx];
        depthMap[y * w + (w - x - 1)] = Math.abs(
          plane.d / (v[0] * plane.n[0] + v[1] * plane.n[1] + v[2] * plane.n[2])
        );
      } else {
        depthMap[y * w + (w - x - 1)] = NO_PLANE;
      }
    }
  }

  return { width: w, height: h, depthMap };
}

class GoogleStreetViewDepthLoader {
  // Set `fallbackToEmpty` to receive an all-sky depth map instead of an error
  // when a panorama has no depth data.
  constructor({ fallbackToEmpty = false } = {}) {
    this.fallbackToEmpty = fallbackToEmpty;
    this.depthMap = null;
  }

  async load(panoId) {
    const json = await fetchPhotometa(panoId, ENTITY_STREET_VIEW);

    try {
      const raw = pick(json, [1, 0, 5, 0, 5, 1, 2], panoId);
      this.depthMap = this.parse(this.decode(raw));
    } catch (e) {
      if (!this.fallbackToEmpty) {
        throw e instanceof PanomNomError
          ? e
          : new PanomNomError(
              ErrorCodes.BAD_METADATA,
              `Could not decode depth map for "${panoId}"`,
              { cause: e }
            );
      }
      this.depthMap = createEmptyDepthMap();
    }

    return this.depthMap;
  }

  decode(rawDepthMap) {
    let data = rawDepthMap;

    // Append '=' in order to make the length of the array a multiple of 4
    while (data.length % 4 != 0) data += "=";

    // Replace '-' by '+' and '_' by '/'
    data = data.replace(/-/g, "+").replace(/_/g, "/");

    // Decode. The payload is plain base64: no zlib involved, despite what
    // GSVPano.js used to do here.
    const decoded = atob(data);

    const depthMap = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; ++i) depthMap[i] = decoded.charCodeAt(i);
    return depthMap;
  }

  parse(bytes) {
    const view = new DataView(bytes.buffer);
    const header = parseHeader(view);

    const required =
      header.offset +
      header.width * header.height +
      header.numberOfPlanes * 16;
    if (bytes.length < required) {
      throw new PanomNomError(
        ErrorCodes.BAD_METADATA,
        `Depth map truncated: header needs ${required} bytes, got ${bytes.length}`
      );
    }

    const { planes, indices } = parsePlanes(header, view);
    return computeDepthMap(header, indices, planes);
  }
}

function createEmptyDepthMap(width = 512, height = 256) {
  const depthMap = new Float32Array(width * height);
  depthMap.fill(NO_PLANE);
  return { width, height, depthMap };
}

export { GoogleStreetViewDepthLoader, createEmptyDepthMap, NO_PLANE };
