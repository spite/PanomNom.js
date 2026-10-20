import { PanoramaViewer } from "./viewer.js";

const MESSAGES = {
  NO_PANO_ID: "No panorama id found in that.",
  ZERO_RESULTS: "Google has no panorama there.",
  NO_IMAGE: "A tile failed to load, so the panorama was abandoned.",
  RATE_LIMITED: "Google is throttling tile requests. Wait a minute before trying again.",
};

// The page furniture shared by the examples: a form, example values, status, and the result
// shown as a sphere or flat, with a download. `load(value, { zoom, progress, status, signal })`
// does the actual work with PanomNom and returns { canvas, credit, name }, where `credit` is
// text or a DOM node. It can also return `flat`, the elements for the flat view, `note`, a
// line for the status, and `onShow(viewer)`. Starting a load aborts `signal` for the last one.
function createDemo({
  label = "Id",
  placeholder = "",
  examples = [],
  zoom = 3,
  zooms = [1, 2, 3, 4, 5],
  input = true,
  autoload = true,
  load,
}) {
  const root = document.querySelector("#demo");
  root.innerHTML = `
    <form>
      ${input ? `<input type="text" aria-label="${label}" placeholder="${placeholder}" spellcheck="false" />` : ""}
      ${zooms ? `<select aria-label="Zoom" title="Zoom level: each one doubles the size">${zooms
        .map((z) => `<option value="${z}" ${z === zoom ? "selected" : ""}>Zoom ${z}</option>`)
        .join("")}</select>` : ""}
      <button type="submit">Load</button>
    </form>
    ${examples.length ? `<div class="examples">Try: ${examples
      .map(([value, name], i) => `<button type="button" data-i="${i}">${name}</button>`)
      .join("")}</div>` : ""}
    <div class="status"><progress max="100" hidden></progress><span></span></div>
    <section class="result" hidden>
      <div class="toolbar">
        <button type="button" data-view="sphere" aria-pressed="true">360°</button>
        <button type="button" data-view="flat" aria-pressed="false">Flat</button>
        <span class="extra"></span>
        <span class="spacer"></span>
        <button type="button" data-download>Download</button>
      </div>
      <div class="view sphere"><span class="hint">Drag to look around, scroll to zoom</span></div>
      <div class="view flat" hidden></div>
      <div class="credit"></div>
    </section>`;

  const form = root.querySelector("form");
  const field = root.querySelector("input");
  const select = root.querySelector("select");
  const status = root.querySelector(".status");
  const bar = status.querySelector("progress");
  const text = status.querySelector("span");
  const result = root.querySelector(".result");
  const sphere = root.querySelector(".sphere");
  const flat = root.querySelector(".flat");
  const credit = root.querySelector(".credit");
  const viewer = new PanoramaViewer(sphere);
  let current = null;
  let running = null;

  const setStatus = (message, { error = false, progress = null } = {}) => {
    text.textContent = message;
    status.classList.toggle("error", error);
    bar.hidden = progress === null;
    if (progress !== null) bar.value = progress;
  };

  const setView = (view) => {
    for (const b of root.querySelectorAll("[data-view]")) {
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    }
    sphere.hidden = view !== "sphere";
    flat.hidden = view !== "flat";
  };

  root.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => setView(b.dataset.view))
  );

  root.querySelector("[data-download]").addEventListener("click", () => {
    if (!current) return;
    current.canvas.toBlob(
      (blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${current.name || "panorama"}.jpg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      "image/jpeg",
      0.92
    );
  });

  // A new load supersedes the one in progress, whose results are then dropped.
  async function run(value) {
    running?.abort();
    const controller = new AbortController();
    running = controller;
    const { signal } = controller;
    setStatus("Loading…", { progress: 0 });
    const started = performance.now();
    try {
      const done = await load(value, {
        zoom: select ? Number(select.value) : undefined,
        progress: (p) => signal.aborted || setStatus(`Loading… ${p.toFixed(0)}%`, { progress: p }),
        status: (message) => signal.aborted || setStatus(message, { progress: 0 }),
        signal,
      });
      if (signal.aborted) return;
      current = done;
      viewer.setPanorama(done.canvas);
      flat.replaceChildren(...(done.flat || [done.canvas]));
      if (done.onShow) done.onShow(viewer);
      credit.replaceChildren(done.credit ?? "");
      result.hidden = false;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const size = `${done.canvas.width} × ${done.canvas.height} in ${seconds} s`;
      setStatus(done.note ? `${size}. ${done.note}` : size);
    } catch (e) {
      if (signal.aborted || e.code === "CANCELLED") return;
      console.error(e);
      setStatus(MESSAGES[e.code] ? `${MESSAGES[e.code]} ${e.message}` : e.message, { error: true });
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(field ? field.value.trim() : undefined);
  });

  root.querySelectorAll(".examples button").forEach((b) =>
    b.addEventListener("click", () => {
      const value = examples[b.dataset.i][0];
      if (field) field.value = value;
      run(value);
    })
  );

  // Starts on the first example, so there's something to look at straight away.
  if (examples.length) {
    if (field) field.value = examples[0][0];
    if (autoload) run(examples[0][0]);
  }

  return {
    run,
    viewer,
    setStatus,
    extra: root.querySelector(".extra"),
    flat,
  };
}

export { createDemo };
