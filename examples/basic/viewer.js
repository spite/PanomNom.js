import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  SRGBColorSpace,
  MathUtils,
  Vector3,
} from "three";

// The longitude that faces the middle of the panorama.
const FRONT = -90;

// A 360° view of an equirectangular canvas: drag to look around, scroll or pinch to zoom.
class PanoramaViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.append(this.renderer.domElement);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(75, 1, 0.1, 2000);
    this.lon = FRONT;
    this.lat = 0;
    this.target = new Vector3();
    this.onFrame = null;

    this.material = new MeshBasicMaterial();
    // Seen from inside, so the sphere is turned inside out.
    const geometry = new SphereGeometry(500, 120, 60).scale(-1, 1, 1);
    this.mesh = new Mesh(geometry, this.material);
    this.scene.add(this.mesh);

    this.addControls();
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Large panoramas are scaled down to what the GPU can hold.
  setPanorama(canvas) {
    const max = this.renderer.capabilities.maxTextureSize;
    let source = canvas;
    if (canvas.width > max) {
      source = document.createElement("canvas");
      source.width = max;
      source.height = Math.round((max * canvas.height) / canvas.width);
      source.getContext("2d").drawImage(canvas, 0, 0, source.width, source.height);
    }
    if (this.material.map) this.material.map.dispose();
    const texture = new CanvasTexture(source);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.material.map = texture;
    this.material.needsUpdate = true;
    this.lon = FRONT;
    this.lat = 0;
  }

  addControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let pinch = 0;
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener("pointermove", (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      if (pointers.size === 1) {
        const scale = this.camera.fov / el.clientHeight;
        this.lon += (e.clientX - last.x) * scale;
        this.lat += (e.clientY - last.y) * scale;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom((pinch - d) * 0.1);
        pinch = d;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY * 0.05);
      },
      { passive: false }
    );
  }

  zoom(delta) {
    this.camera.fov = MathUtils.clamp(this.camera.fov + delta, 20, 100);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    if (!this.container.offsetParent) return;
    if (this.onFrame) this.onFrame();
    this.lat = MathUtils.clamp(this.lat, -85, 85);
    const phi = MathUtils.degToRad(90 - this.lat);
    const theta = MathUtils.degToRad(this.lon);
    this.target.setFromSphericalCoords(1, phi, theta).add(this.camera.position);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }
}

export { PanoramaViewer };
