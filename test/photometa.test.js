import { test } from "node:test";
import assert from "node:assert/strict";

const { fetchPhotometa } = await import("../src/photometa.js");
const { ErrorCodes } = await import("../src/errors.js");

test("a photometa request that never reaches Google is NETWORK, not a bare TypeError", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(fetchPhotometa("anything", 2), (e) => {
    assert.equal(e.code, ErrorCodes.NETWORK);
    assert.ok(e.cause instanceof TypeError);
    return true;
  });
});
