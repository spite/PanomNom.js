class GoogleStreetViewDepthLoader {
  constructor() {}

  async load(panoId) {
    var self = this;

    //const url = `http://maps.google.com/cbk?output=json&hl=x-local&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=${panoId}`;
    const url = `https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=uk&pb=!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2suk!3m3!1m2!1e2!2s${panoId}!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3`;

    const res = await fetch(url);
    const text = await res.text();
    const json = JSON.parse(text.substr(4));
    const dm = json[1][0][5][0][5][1][2];

    var decoded, depthMap;
    try {
      decoded = self.decode(dm);
      depthMap = self.parse(decoded);
    } catch (e) {
      depthMap = self.createEmptyDepthMap();
      throw new Error(e);
    }
    return depthMap;
  }

  decode(rawDepthMap) {
    var self = this,
      i,
      compressedDepthMapData,
      depthMap,
      decompressedDepthMap;

    // Append '=' in order to make the length of the array a multiple of 4
    while (rawDepthMap.length % 4 != 0) rawDepthMap += "=";

    // Replace '-' by '+' and '_' by '/'
    rawDepthMap = rawDepthMap.replace(/-/g, "+");
    rawDepthMap = rawDepthMap.replace(/_/g, "/");

    // Decode and decompress data
    decompressedDepthMap = atob(rawDepthMap);

    // Convert output of decompressor to Uint8Array
    depthMap = new Uint8Array(decompressedDepthMap.length);
    for (i = 0; i < decompressedDepthMap.length; ++i)
      depthMap[i] = decompressedDepthMap.charCodeAt(i);
    return depthMap;
  }

  parseHeader(depthMap) {
    return {
      headerSize: depthMap.getUint8(0),
      numberOfPlanes: depthMap.getUint16(1, true),
      width: depthMap.getUint16(3, true),
      height: depthMap.getUint16(5, true),
      offset: depthMap.getUint16(7, true),
    };
  }

  parsePlanes(header, depthMap) {
    var planes = [],
      indices = [],
      i,
      n = [0, 0, 0],
      d,
      byteOffset;

    for (i = 0; i < header.width * header.height; ++i) {
      indices.push(depthMap.getUint8(header.offset + i));
    }

    for (i = 0; i < header.numberOfPlanes; ++i) {
      byteOffset = header.offset + header.width * header.height + i * 4 * 4;
      n[0] = depthMap.getFloat32(byteOffset, true);
      n[1] = depthMap.getFloat32(byteOffset + 4, true);
      n[2] = depthMap.getFloat32(byteOffset + 8, true);
      d = depthMap.getFloat32(byteOffset + 12, true);
      planes.push({
        n: n.slice(0),
        d: d,
      });
    }

    return { planes: planes, indices: indices };
  }

  computeDepthMap(header, indices, planes) {
    var depthMap = null,
      x,
      y,
      planeIdx,
      phi,
      theta,
      v = [0, 0, 0],
      w = header.width,
      h = header.height,
      plane,
      t,
      p;

    depthMap = new Float32Array(w * h);

    var sin_theta = new Float32Array(h);
    var cos_theta = new Float32Array(h);
    var sin_phi = new Float32Array(w);
    var cos_phi = new Float32Array(w);

    for (y = 0; y < h; ++y) {
      theta = ((h - y - 0.5) / h) * Math.PI;
      sin_theta[y] = Math.sin(theta);
      cos_theta[y] = Math.cos(theta);
    }
    for (x = 0; x < w; ++x) {
      phi = ((w - x - 0.5) / w) * 2 * Math.PI + Math.PI / 2;
      sin_phi[x] = Math.sin(phi);
      cos_phi[x] = Math.cos(phi);
    }

    for (y = 0; y < h; ++y) {
      for (x = 0; x < w; ++x) {
        planeIdx = indices[y * w + x];

        v[0] = sin_theta[y] * cos_phi[x];
        v[1] = sin_theta[y] * sin_phi[x];
        v[2] = cos_theta[y];

        if (planeIdx > 0) {
          plane = planes[planeIdx];

          t = Math.abs(
            plane.d /
              (v[0] * plane.n[0] + v[1] * plane.n[1] + v[2] * plane.n[2])
          );
          depthMap[y * w + (w - x - 1)] = t;
        } else {
          depthMap[y * w + (w - x - 1)] = 9999999999999999999;
        }
      }
    }

    return {
      width: w,
      height: h,
      depthMap: depthMap,
    };
  }

  parse(depthMap) {
    var self = this,
      depthMapData,
      header,
      data,
      depthMap;

    depthMapData = new DataView(depthMap.buffer);
    header = self.parseHeader(depthMapData);
    data = self.parsePlanes(header, depthMapData);
    depthMap = self.computeDepthMap(header, data.indices, data.planes);

    return depthMap;
  }

  createEmptyDepthMap() {
    var depthMap = {
      width: 512,
      height: 256,
      depthMap: new Float32Array(512 * 256),
    };
    for (var i = 0; i < 512 * 256; ++i)
      depthMap.depthMap[i] = 9999999999999999999;
    return depthMap;
  }
}

export { GoogleStreetViewDepthLoader };
