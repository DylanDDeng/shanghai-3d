import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  DistanceDisplayCondition,
  GeometryInstance,
  LabelCollection,
  LabelStyle,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  VerticalOrigin,
  Viewer,
} from 'cesium';
import type { Feature } from 'geojson';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { iterateLines, lineToCartesians, loadGeoJson } from '../utils/geojson';
import { PALETTE } from './palette';
import type { TimeOfDay } from '../types';
import type { CameraController } from '../cesium/camera';

/** Road classes produced by scripts/process-geojson/process-pbf.ts, with their LOD tier. */
export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'local' | 'service' | 'path';

interface ClassSpec {
  maxDistance: number; // show when view distance < this (m)
  width: number;
  color: (t: TimeOfDay) => Color;
}

const SPEC: Record<RoadClass, ClassSpec> = {
  motorway: { maxDistance: 400_000, width: 2.4, color: (t) => PALETTE[t].roadMotorway },
  primary: { maxDistance: 60_000, width: 1.8, color: (t) => PALETTE[t].roadPrimary },
  secondary: { maxDistance: 18_000, width: 1.4, color: (t) => PALETTE[t].roadSecondary },
  local: { maxDistance: 6_000, width: 1.1, color: (t) => PALETTE[t].roadSecondary.withAlpha(0.5) },
  service: { maxDistance: 2_500, width: 0.9, color: (t) => PALETTE[t].roadSecondary.withAlpha(0.35) },
  path: {
    maxDistance: 1_500,
    width: 0.8,
    color: (t) =>
      (t === 'night' ? Color.fromCssColorString('#6fa8dc') : Color.fromCssColorString('#7c8a99')).withAlpha(
        0.35,
      ),
  },
};

/** Grid cells are fetched when the camera is within this distance and dropped beyond ~2× it. */
const CELL_LOAD_DISTANCE = 16_000;
const CELL_RADIUS_M = 7_000;
const LABEL_MAX_DISTANCE = 2_600;

interface CellIndexEntry {
  key: string;
  bbox: [number, number, number, number];
  counts: Record<string, number>;
  bytes: number;
}

interface LoadedCell {
  primitives: Partial<Record<RoadClass, Primitive>>;
  labels: LabelCollection | null;
  lastUsed: number;
}

/**
 * Whole-municipality roads:
 *  - motorway/trunk/primary: one city-wide file, two primitives, always resident (far LOD)
 *  - everything else (secondary … footpaths): 0.06° grid cells streamed around the camera, one primitive per
 *    class per cell so each class can switch on/off by distance; named streets get labels at street level.
 */
export class RoadsLayer implements Layer {
  readonly id = 'roads' as const;
  private viewer!: Viewer;
  private camera!: CameraController;
  private global: Partial<Record<RoadClass, { lines: number[][][]; primitive: Primitive | null }>> = {};
  private index: CellIndexEntry[] = [];
  private cells = new Map<string, LoadedCell>();
  private cellData = new Map<string, Promise<Feature[]>>();
  private time: TimeOfDay = 'day';
  private visible = true;
  private opacity = 1;
  private viewDistance = 1e9;
  private updating = false;
  private frame = 0;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    this.camera = ctx.camera;
    const major = await loadGeoJson(dataUrl('geojson/roads-major.geojson'));
    for (const f of major.features) {
      const cls =
        (f.properties?.cls as RoadClass | undefined) ??
        (String(f.properties?.highway).startsWith('primary') ? 'primary' : 'motorway');
      const g = (this.global[cls] ??= { lines: [], primitive: null });
      for (const line of iterateLines(f.geometry)) if (line.length > 1) g.lines.push(line as number[][]);
    }
    for (const cls of Object.keys(this.global) as RoadClass[]) this.buildGlobal(cls);
    try {
      const res = await fetch(dataUrl('geojson/roads/index.json'));
      if (res.ok) this.index = ((await res.json()) as { cells: CellIndexEntry[] }).cells;
      else console.warn('[roads] no grid index (run npm run data:pbf); only major roads available');
    } catch (e) {
      console.warn('[roads] grid index unavailable', e);
    }
  }

  // ---------------------------------------------------------------- primitives

  private makePrimitive(cls: RoadClass, lines: number[][][]): Primitive {
    const spec = SPEC[cls];
    const c = spec.color(this.time);
    const color = ColorGeometryInstanceAttribute.fromColor(c.withAlpha(c.alpha * this.opacity));
    const width = spec.width * (this.time === 'night' ? 1.3 : 1);
    const instances = lines.map(
      (line) =>
        new GeometryInstance({
          geometry: new PolylineGeometry({ positions: lineToCartesians(line, 1.5), width }),
          attributes: { color },
        }),
    );
    return new Primitive({
      geometryInstances: instances,
      appearance: new PolylineColorAppearance({ translucent: true }),
      asynchronous: true,
    });
  }

  private buildGlobal(cls: RoadClass) {
    const g = this.global[cls];
    if (!g) return;
    if (g.primitive) this.viewer.scene.primitives.remove(g.primitive);
    g.primitive = g.lines.length ? this.viewer.scene.primitives.add(this.makePrimitive(cls, g.lines)) : null;
    this.updateVisibility();
  }

  private showClass(cls: RoadClass): boolean {
    return this.visible && this.viewDistance < SPEC[cls].maxDistance;
  }

  private updateVisibility() {
    for (const cls of Object.keys(this.global) as RoadClass[]) {
      const p = this.global[cls]?.primitive;
      if (p) p.show = this.showClass(cls);
    }
    for (const cell of this.cells.values()) {
      for (const [cls, p] of Object.entries(cell.primitives) as [RoadClass, Primitive][])
        p.show = this.showClass(cls);
      if (cell.labels) cell.labels.show = this.visible && this.viewDistance < LABEL_MAX_DISTANCE;
    }
  }

  // ---------------------------------------------------------------- grid streaming

  private fetchCell(key: string): Promise<Feature[]> {
    let p = this.cellData.get(key);
    if (!p) {
      p = loadGeoJson(dataUrl(`geojson/roads/${key}.geojson`)).then((fc) => fc.features);
      this.cellData.set(key, p);
      p.catch(() => this.cellData.delete(key));
    }
    return p;
  }

  private async mountCell(entry: CellIndexEntry) {
    const features = await this.fetchCell(entry.key);
    if (this.cells.has(entry.key) || !this.viewer) return;
    const byClass = new Map<RoadClass, number[][][]>();
    const labels = new LabelCollection();
    const named = new Set<string>();
    for (const f of features) {
      const cls = f.properties?.cls as RoadClass;
      if (!SPEC[cls]) continue;
      for (const line of iterateLines(f.geometry)) {
        if (line.length < 2) continue;
        (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push(line as number[][]);
        const name = f.properties?.name as string | undefined;
        if (name && cls !== 'path' && cls !== 'service' && !named.has(name) && line.length >= 3) {
          named.add(name);
          const mid = line[Math.floor(line.length / 2)];
          labels.add({
            position: Cartesian3.fromDegrees(mid[0], mid[1], 3),
            text: name,
            font: '500 11px "Inter", "PingFang SC", system-ui, sans-serif',
            fillColor: Color.WHITE.withAlpha(0.9),
            outlineColor: Color.BLACK.withAlpha(0.85),
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, 0),
            distanceDisplayCondition: new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
      }
    }
    const cell: LoadedCell = { primitives: {}, labels: null, lastUsed: this.frame };
    for (const [cls, lines] of byClass)
      cell.primitives[cls] = this.viewer.scene.primitives.add(this.makePrimitive(cls, lines));
    cell.labels = labels.length ? this.viewer.scene.primitives.add(labels) : null;
    if (!cell.labels) labels.destroy();
    this.cells.set(entry.key, cell);
    this.updateVisibility();
  }

  private unmountCell(key: string) {
    const cell = this.cells.get(key);
    if (!cell) return;
    for (const p of Object.values(cell.primitives)) this.viewer.scene.primitives.remove(p);
    if (cell.labels) this.viewer.scene.primitives.remove(cell.labels);
    this.cells.delete(key);
  }

  /** Which grid cells are within CELL_RADIUS_M of the point the camera looks at. */
  private wantedCells(): CellIndexEntry[] {
    if (!this.index.length || this.viewDistance > CELL_LOAD_DISTANCE) return [];
    const target = this.camera.getViewTarget();
    if (!target) return [];
    const dLat = CELL_RADIUS_M / 111_000;
    const dLon = dLat / Math.cos((target.latitude * Math.PI) / 180);
    return this.index.filter(
      (c) =>
        c.bbox[2] > target.longitude - dLon &&
        c.bbox[0] < target.longitude + dLon &&
        c.bbox[3] > target.latitude - dLat &&
        c.bbox[1] < target.latitude + dLat,
    );
  }

  private async updateCells() {
    if (this.updating) return;
    this.updating = true;
    try {
      this.frame++;
      const wanted = this.wantedCells();
      const wantedKeys = new Set(wanted.map((c) => c.key));
      for (const key of [...this.cells.keys()]) {
        if (wantedKeys.has(key)) this.cells.get(key)!.lastUsed = this.frame;
        else if (this.frame - this.cells.get(key)!.lastUsed > 3) this.unmountCell(key);
      }
      // nearest first so streets around the target appear before the periphery
      const target = this.camera.getViewTarget();
      wanted.sort((a, b) => dist2(a, target) - dist2(b, target));
      await Promise.all(
        wanted
          .filter((c) => !this.cells.has(c.key))
          .slice(0, 12)
          .map((c) => this.mountCell(c).catch((e) => console.warn('[roads] cell', c.key, e))),
      );
    } finally {
      this.updating = false;
    }
  }

  // ---------------------------------------------------------------- Layer API

  setVisible(v: boolean): void {
    this.visible = v;
    this.updateVisibility();
  }
  setOpacity(o: number): void {
    this.opacity = o;
    this.rebuildAll();
  }
  applyTime(time: TimeOfDay): void {
    if (time === this.time) return;
    this.time = time;
    this.rebuildAll();
  }
  private rebuildAll() {
    for (const cls of Object.keys(this.global) as RoadClass[]) this.buildGlobal(cls);
    const keys = [...this.cells.keys()];
    for (const k of keys) this.unmountCell(k);
    void this.updateCells();
  }
  onCameraChange(viewDistance: number): void {
    this.viewDistance = viewDistance;
    this.updateVisibility();
    void this.updateCells();
  }
  dispose(): void {
    for (const g of Object.values(this.global))
      if (g?.primitive) this.viewer.scene.primitives.remove(g.primitive);
    for (const k of [...this.cells.keys()]) this.unmountCell(k);
  }
}

function dist2(c: CellIndexEntry, t: { longitude: number; latitude: number } | null): number {
  if (!t) return 0;
  const cx = (c.bbox[0] + c.bbox[2]) / 2;
  const cy = (c.bbox[1] + c.bbox[3]) / 2;
  return (cx - t.longitude) ** 2 + (cy - t.latitude) ** 2;
}
