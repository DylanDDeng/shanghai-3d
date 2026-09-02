import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  DistanceDisplayCondition,
  GeometryInstance,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  VerticalOrigin,
  Viewer,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { iterateLines, lineToCartesians, loadGeoJson } from '../utils/geojson';
import type { SearchResult, StationSelection, TimeOfDay } from '../types';

interface StationRecord {
  name: string;
  nameEn?: string;
  lines: string[];
  longitude: number;
  latitude: number;
}

/** Shanghai Metro lines (colored by OSM `colour`) and stations with labels + hover/click. */
export class MetroLayer implements Layer {
  readonly id = 'metro' as const;
  private viewer!: Viewer;
  private lines: Primitive | null = null;
  private points: PointPrimitiveCollection | null = null;
  private labels: LabelCollection | null = null;
  private stations: StationRecord[] = [];
  private visible = false;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const [linesFc, stationsFc] = await Promise.all([
      loadGeoJson(dataUrl('geojson/metro-lines.geojson')),
      loadGeoJson(dataUrl('geojson/metro-stations.geojson')),
    ]);
    const instances: GeometryInstance[] = [];
    for (const f of linesFc.features) {
      const colour = Color.fromCssColorString(String(f.properties?.colour ?? '#ffffff')) ?? Color.WHITE;
      for (const line of iterateLines(f.geometry)) {
        if (line.length < 2) continue;
        instances.push(
          new GeometryInstance({
            geometry: new PolylineGeometry({ positions: lineToCartesians(line, 3), width: 3 }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(colour.withAlpha(0.9)) },
            id: { layer: 'metro-line', ref: f.properties?.ref, name: f.properties?.name },
          }),
        );
      }
    }
    this.lines = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: instances,
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
      }),
    );

    this.points = this.viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.labels = this.viewer.scene.primitives.add(new LabelCollection());
    for (const f of stationsFc.features) {
      if (f.geometry.type !== 'Point') continue;
      const [lon, lat] = f.geometry.coordinates;
      const rec: StationRecord = {
        name: String(f.properties?.name ?? ''),
        nameEn: f.properties?.nameEn as string | undefined,
        lines: (f.properties?.lines as string[] | undefined) ?? [],
        longitude: lon,
        latitude: lat,
      };
      this.stations.push(rec);
      const pos = Cartesian3.fromDegrees(lon, lat, 4);
      this.points!.add({
        position: pos,
        pixelSize: 7,
        color: Color.WHITE,
        outlineColor: Color.fromCssColorString('#1c2733'),
        outlineWidth: 2,
        scaleByDistance: new NearFarScalar(2000, 1.2, 30000, 0.5),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 40_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { layer: 'metro-station', station: rec } as unknown as object,
      });
      this.labels!.add({
        position: pos,
        text: rec.name,
        font: '12px "Inter", "PingFang SC", system-ui, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -9),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 6000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    this.setVisible(this.visible);
  }

  /** Convert a Cesium pick result into a station selection if it is one of ours. */
  stationFromPick(picked: unknown): StationSelection | null {
    const id = (picked as { id?: { layer?: string; station?: StationRecord } } | undefined)?.id;
    if (!id || id.layer !== 'metro-station' || !id.station) return null;
    const s = id.station;
    return {
      kind: 'station',
      name: s.name,
      lines: s.lines,
      position: { longitude: s.longitude, latitude: s.latitude },
    };
  }

  search(query: string, limit = 8): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const s of this.stations) {
      if (s.name.includes(query) || s.nameEn?.toLowerCase().includes(q)) {
        out.push({
          id: `station:${s.name}`,
          label: s.name,
          sublabel: [s.nameEn, s.lines.length ? `Line ${s.lines.join('/')}` : ''].filter(Boolean).join(' · '),
          kind: 'station',
          position: { longitude: s.longitude, latitude: s.latitude },
        });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (this.lines) this.lines.show = v;
    if (this.points) this.points.show = v;
    if (this.labels) this.labels.show = v;
  }
  setOpacity(): void {
    /* not supported for now */
  }
  applyTime(_time: TimeOfDay): void {
    /* metro colors are line-brand colors and stay constant */
  }
  dispose(): void {
    const p = this.viewer.scene.primitives;
    if (this.lines) p.remove(this.lines);
    if (this.points) p.remove(this.points);
    if (this.labels) p.remove(this.labels);
    this.lines = null;
    this.points = null;
    this.labels = null;
  }
}
