import * as THREE from 'three';
import { Cartesian3, Viewer, PerspectiveFrustum } from 'cesium';

/**
 * A transparent Three.js canvas stacked on top of Cesium, with its camera synchronized every frame.
 * Coordinates are ECEF metres relative to the Cesium camera position (floating origin) so precision holds.
 * Used for special effects only (precipitation, particles, holograms) — never for GIS content.
 */
export class ThreeOverlay {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 100_000);
  /** Group whose axes are East/North/Up at the camera position (unit: metres, origin = camera). */
  readonly enu = new THREE.Group();
  private disposed = false;
  private tickers = new Set<(dt: number, overlay: ThreeOverlay) => void>();
  private last = performance.now();
  private removeListener: () => void;

  constructor(
    private readonly viewer: Viewer,
    container: HTMLElement,
  ) {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.enu);
    const onPost = () => this.render();
    this.viewer.scene.postRender.addEventListener(onPost);
    this.removeListener = () => this.viewer.scene.postRender.removeEventListener(onPost);
  }

  addTicker(fn: (dt: number, overlay: ThreeOverlay) => void): () => void {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  get active(): boolean {
    return this.scene.children.some((c) => c !== this.enu) || this.enu.children.length > 0;
  }

  private syncCamera() {
    const cam = this.viewer.camera;
    const canvas = this.viewer.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    const frustum = cam.frustum as PerspectiveFrustum;
    if (frustum.fovy) this.camera.fov = THREE.MathUtils.radToDeg(frustum.fovy);
    this.camera.near = Math.max(0.5, frustum.near);
    this.camera.far = Math.min(frustum.far, 200_000);
    this.camera.updateProjectionMatrix();

    // Orientation: Three camera looks down -Z with +Y up. Build basis from Cesium right/up/-direction.
    const r = cam.rightWC;
    const u = cam.upWC;
    const d = cam.directionWC;
    const m = new THREE.Matrix4().set(r.x, u.x, -d.x, 0, r.y, u.y, -d.y, 0, r.z, u.z, -d.z, 0, 0, 0, 0, 1);
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.position.set(0, 0, 0);

    // ENU frame at camera position (ECEF-relative, origin = camera)
    const p = cam.positionWC;
    const up = Cartesian3.normalize(p, new Cartesian3());
    const east = Cartesian3.normalize(
      Cartesian3.cross(Cartesian3.UNIT_Z, up, new Cartesian3()),
      new Cartesian3(),
    );
    const north = Cartesian3.cross(up, east, new Cartesian3());
    const basis = new THREE.Matrix4().set(
      east.x,
      north.x,
      up.x,
      0,
      east.y,
      north.y,
      up.y,
      0,
      east.z,
      north.z,
      up.z,
      0,
      0,
      0,
      0,
      1,
    );
    this.enu.quaternion.setFromRotationMatrix(basis);
  }

  private render() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.active) return;
    this.syncCamera();
    for (const t of this.tickers) t(dt, this);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.removeListener();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
