import {
  Cartesian3,
  Cartographic,
  EasingFunction,
  HeadingPitchRange,
  Math as CesiumMath,
  Rectangle,
  Viewer,
  BoundingSphere,
} from 'cesium';
import { SHANGHAI_BBOX, SHANGHAI_CENTER, findDistrict, findPlace } from '../geo/shanghai';
import { cartesianToWgs84, wgs84ToCartesian, distanceMeters, type LonLatHeight } from '../geo/coordinates';
import type { CameraState } from '../types';

export interface FlyOptions {
  /** seconds; when omitted a cinematic duration is derived from travel distance */
  duration?: number;
  heading?: number; // degrees
  pitch?: number; // degrees (negative = looking down)
  /** distance from target (m). If omitted with a `height`, the camera is placed at that height above the target. */
  range?: number;
}

/** Drop undefined keys so spreads do not override defaults. */
function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The only place in the app that touches Cesium's camera. Business code and the Scene API call this.
 */
export class CameraController {
  private listeners = new Set<(s: CameraState) => void>();
  private cancelCurrent: (() => void) | null = null;

  constructor(private readonly viewer: Viewer) {
    viewer.camera.changed.addEventListener(() => this.emit());
    viewer.camera.percentageChanged = 0.01;
  }

  // ------------------------------------------------------------ state

  getState(): CameraState {
    const cam = this.viewer.camera;
    const carto = Cartographic.fromCartesian(cam.positionWC);
    return {
      longitude: CesiumMath.toDegrees(carto.longitude),
      latitude: CesiumMath.toDegrees(carto.latitude),
      height: carto.height,
      heading: CesiumMath.toDegrees(cam.heading),
      pitch: CesiumMath.toDegrees(cam.pitch),
    };
  }

  onChange(cb: (s: CameraState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    if (this.listeners.size === 0) return;
    const s = this.getState();
    this.listeners.forEach((cb) => cb(s));
  }

  /** Approximate distance from the camera to the ground point it looks at, or camera height if none. */
  getViewDistance(): number {
    const cam = this.viewer.camera;
    const ray = cam.getPickRay(
      new Cartesian3(this.viewer.canvas.clientWidth / 2, this.viewer.canvas.clientHeight / 2) as never,
    );
    if (ray) {
      const hit = this.viewer.scene.globe.pick(ray, this.viewer.scene);
      if (hit) return Cartesian3.distance(cam.positionWC, hit);
    }
    return cam.positionCartographic.height;
  }

  /** Lon/lat of the ground point at the screen centre (null when looking at the sky). */
  getViewTarget(): { longitude: number; latitude: number } | null {
    const cam = this.viewer.camera;
    const ray = cam.getPickRay(
      new Cartesian3(this.viewer.canvas.clientWidth / 2, this.viewer.canvas.clientHeight / 2) as never,
    );
    const hit = ray ? this.viewer.scene.globe.pick(ray, this.viewer.scene) : undefined;
    if (!hit) return null;
    const c = cartesianToWgs84(hit);
    return { longitude: c.longitude, latitude: c.latitude };
  }

  // ------------------------------------------------------------ flights

  /** Cinematic duration: quick for short hops, up to ~6 s for cross-city flights, longer from space. */
  private durationFor(target: LonLatHeight, targetRange: number): number {
    const from = this.getState();
    const d = distanceMeters(from, target);
    const dh = Math.abs(from.height - targetRange);
    const metric = Math.max(d, dh);
    return CesiumMath.clamp(1.2 + Math.log10(1 + metric / 200) * 1.3, 1.2, 7);
  }

  /**
   * Fly to look at a ground/air point. `target.height` is the focal point's height (default 0, the ground);
   * `opts.range` is the camera distance from that point (default 2 km). Pitch defaults to -45°.
   */
  flyToCoordinates(target: LonLatHeight, opts: FlyOptions = {}): Promise<void> {
    const pitch = opts.pitch ?? -45;
    const heading = opts.heading ?? 0;
    const range = Math.max(opts.range ?? 2000, 60);
    const center = wgs84ToCartesian(target.longitude, target.latitude, target.height ?? 0);
    const duration = opts.duration ?? this.durationFor(target, range);
    return this.flyToBoundingSphere(
      new BoundingSphere(center, 1),
      new HeadingPitchRange(CesiumMath.toRadians(heading), CesiumMath.toRadians(pitch), range),
      duration,
    );
  }

  private flyToBoundingSphere(
    sphere: BoundingSphere,
    hpr: HeadingPitchRange,
    duration: number,
  ): Promise<void> {
    this.cancelCurrent?.();
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.cancelCurrent = null;
        resolve();
      };
      this.cancelCurrent = () => {
        this.viewer.camera.cancelFlight();
        done();
      };
      this.viewer.camera.flyToBoundingSphere(sphere, {
        offset: hpr,
        duration,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT,
        complete: done,
        cancel: done,
      });
    });
  }

  /** Whole-municipality overview. */
  flyToShanghai(opts: FlyOptions = {}): Promise<void> {
    return this.flyToCoordinates(SHANGHAI_CENTER, { range: 140_000, pitch: -55, heading: 0, ...opts });
  }

  /** Overview of the dense urban core (Puxi + Lujiazui + Huangpu River). */
  flyToInnerCity(opts: FlyOptions = {}): Promise<void> {
    return this.flyToCoordinates(
      { longitude: 121.49, latitude: 31.225 },
      { range: 22_000, pitch: -50, heading: 0, ...opts },
    );
  }

  flyToDistrict(idOrName: string, opts: FlyOptions = {}): Promise<void> {
    const d = findDistrict(idOrName);
    if (!d) return Promise.reject(new Error(`Unknown district: ${idOrName}`));
    return this.flyToCoordinates(d.center, { range: d.viewHeight, pitch: -60, ...compact(opts) });
  }

  flyToLandmark(idOrName: string, opts: FlyOptions = {}): Promise<void> {
    const p = findPlace(idOrName);
    if (!p) return Promise.reject(new Error(`Unknown place: ${idOrName}`));
    const focal = p.kind === 'landmark' ? (p.position.height ?? 0) * 0.45 : 0;
    return this.flyToCoordinates(
      { longitude: p.position.longitude, latitude: p.position.latitude, height: focal },
      { range: p.view.range, pitch: p.view.pitch, heading: p.view.heading ?? 0, ...compact(opts) },
    );
  }

  flyToRectangle(
    rect: { west: number; south: number; east: number; north: number },
    duration?: number,
  ): Promise<void> {
    this.cancelCurrent?.();
    return new Promise((resolve) => {
      this.viewer.camera.flyTo({
        destination: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
        duration: duration ?? 3,
        complete: resolve,
        cancel: resolve,
      });
    });
  }

  /** Instantly place the camera (used for the initial "from space" view). */
  setView(target: LonLatHeight, heading = 0, pitch = -90): void {
    this.viewer.camera.setView({
      destination: wgs84ToCartesian(target.longitude, target.latitude, target.height ?? 10_000_000),
      orientation: { heading: CesiumMath.toRadians(heading), pitch: CesiumMath.toRadians(pitch), roll: 0 },
    });
  }

  // ------------------------------------------------------------ orientation helpers

  setHeading(degrees: number): void {
    const s = this.getState();
    this.orbit(degrees, s.pitch);
  }

  setPitch(degrees: number): void {
    const s = this.getState();
    this.orbit(s.heading, CesiumMath.clamp(degrees, -89.9, 5));
  }

  /** Re-orient around the currently viewed ground point keeping the same distance. */
  orbit(heading: number, pitch: number): void {
    const cam = this.viewer.camera;
    const range = this.getViewDistance();
    const ray = cam.getPickRay(
      new Cartesian3(this.viewer.canvas.clientWidth / 2, this.viewer.canvas.clientHeight / 2) as never,
    );
    const hit = ray ? this.viewer.scene.globe.pick(ray, this.viewer.scene) : undefined;
    if (!hit) return;
    const sphere = new BoundingSphere(hit, 1);
    cam.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(CesiumMath.toRadians(heading), CesiumMath.toRadians(pitch), range),
      duration: 0.6,
    });
  }

  zoomIn(factor = 0.5): void {
    const d = this.getViewDistance();
    this.viewer.camera.zoomIn(d * factor);
  }

  zoomOut(factor = 1): void {
    const d = this.getViewDistance();
    this.viewer.camera.zoomOut(d * factor);
  }

  /** Points the camera north, looking straight down at the current spot. */
  resetOrientation(): void {
    this.orbit(0, -89);
  }

  reset(): Promise<void> {
    return this.flyToShanghai();
  }

  /** Whether the camera is inside the Shanghai bbox at a "city" altitude — used by LOD decisions. */
  isOverShanghai(): boolean {
    const s = this.getState();
    return (
      s.longitude > SHANGHAI_BBOX.west - 1 &&
      s.longitude < SHANGHAI_BBOX.east + 1 &&
      s.latitude > SHANGHAI_BBOX.south - 1 &&
      s.latitude < SHANGHAI_BBOX.north + 1
    );
  }

  cartesianToWgs84 = cartesianToWgs84;
}
