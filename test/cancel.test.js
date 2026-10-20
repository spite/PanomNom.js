import { test } from "node:test";
import assert from "node:assert/strict";

import { installDOM, loads } from "./dom-stub.js";

installDOM();

const { GooglePhotoSphereLoader } = await import("../src/GooglePhotoSphereLoader.js");
const { ErrorCodes } = await import("../src/errors.js");

// Photo sphere metadata for "<name>" whose single level is w x h, served from media "<name>".
function photometa(name, w, h) {
  const node = [];
  node[2] = [null, null, [h, w], [[[[h, w]]], [512, 512]]];
  node[17] = [[`https://lh3.googleusercontent.com/gpms-cs-s/${name}=w0-h0`]];
  return [null, [node]];
}

const tileFetch = globalThis.fetch;
const delays = { CIslow: 10, CIfast: 1 };
globalThis.fetch = async (url, options) => {
  if (!url.includes("/photometa/")) return tileFetch(url, options);
  const name = url.match(/!1e10!2s([^!]+)/)[1];
  await new Promise((r) => setTimeout(r, delays[name] ?? 1));
  options?.signal?.throwIfAborted();
  const reply = name === "CIslow" ? photometa(name, 2048, 1024) : photometa(name, 1024, 512);
  return { ok: true, status: 200, text: async () => ")]}'\n" + JSON.stringify(reply) };
};

const tilesOf = (name) => loads.filter((u) => u.includes(`/${name}=`));

test("a second load cancels the first, so their tiles never share the canvas", async () => {
  const loader = new GooglePhotoSphereLoader();
  const ctx = loader.canvas.getContext();
  loads.length = 0;
  ctx.drawn.length = 0;

  const first = loader.load("CIslow", 0);
  const second = loader.load("CIfast", 0);

  await assert.rejects(first, (e) => e.code === ErrorCodes.CANCELLED);
  await second;
  assert.equal(loader.canvas.width, 1024);
  assert.equal(tilesOf("CIslow").length, 0, "the cancelled load must not fetch tiles");
  assert.equal(ctx.drawn.length, tilesOf("CIfast").length);
});

test("cancel() stops a load in progress", async () => {
  const loader = new GooglePhotoSphereLoader();
  const run = loader.load("CIslow", 0);
  loader.cancel();
  await assert.rejects(run, (e) => e.code === ErrorCodes.CANCELLED);
});

test("a load can follow a cancelled one", async () => {
  const loader = new GooglePhotoSphereLoader();
  const run = loader.load("CIslow", 0);
  loader.cancel();
  await run.catch(() => {});
  await loader.load("CIfast", 0);
  assert.equal(loader.canvas.width, 1024);
});
