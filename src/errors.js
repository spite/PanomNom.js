const ErrorCodes = {
  NO_PANO_ID: "NO_PANO_ID",
  NO_IMAGE: "NO_IMAGE",
  ZERO_RESULTS: "ZERO_RESULTS",
  BAD_METADATA: "BAD_METADATA",
  INVALID_ZOOM: "INVALID_ZOOM",
  // Google is throttling this client. Distinguishable only because tiles are
  // fetched rather than loaded through an <img>, which cannot report a status.
  RATE_LIMITED: "RATE_LIMITED",
};

class PanomNomError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "PanomNomError";
    this.code = code;
  }
}

export { PanomNomError, ErrorCodes };
