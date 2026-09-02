import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  Entity,
  GeoJsonDataSource,
  LabelStyle,
  PolygonHierarchy,
  Viewer,
  VerticalOrigin,
  Cartesian2,
  DistanceDisplayCondition,
  ConstantProperty,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { PALETTE } from './palette';
import type { TimeOfDay } from '../types';
import { DISTRICTS } from '../geo/shanghai';

/**
 * Administrative district polygons (admin_level=6 from OSM), with hover / highlight support.
 * Uses entities (only 16 features) so per-entity material updates are cheap.
 */
export class DistrictsLayer implements Layer {
  readonly id = 'districts' as const;
  private viewer!: Viewer;
  private ds: GeoJsonDataSource | null = null;
  private byId = new Map<string, Entity>();
  private labels: Entity[] = [];
  private hovered: string | null = null;
  private highlighted = new Set<string>();
  private time: TimeOfDay = 'day';

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    this.ds = await GeoJsonDataSource.load(dataUrl('geojson/districts.geojson'), { clampToGround: false });
    await this.viewer.dataSources.add(this.ds);
    for (const e of this.ds.entities.values) {
      const id = e.properties?.id?.getValue() as string | undefined;
      if (!id) continue;
      this.byId.set(id, e);
      if (e.polygon) {
        e.polygon.height = new ConstantProperty(2);
        e.polygon.outline = new ConstantProperty(true);
        e.polygon.outlineWidth = new ConstantProperty(2);
        e.polygon.arcType = undefined;
      }
    }
    // Labels at district centers (fade out when close)
    for (const d of DISTRICTS) {
      const label = this.ds.entities.add({
        position: Cartesian3.fromDegrees(d.center.longitude, d.center.latitude, 50),
        label: {
          text: `${d.name}\n${d.nameEn}`,
          font: '500 13px "Inter", "PingFang SC", system-ui, sans-serif',
          fillColor: Color.WHITE.withAlpha(0.85),
          outlineColor: Color.BLACK.withAlpha(0.8),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, 0),
          distanceDisplayCondition: new DistanceDisplayCondition(25_000, 400_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: undefined,
        },
      });
      this.labels.push(label);
    }
    this.restyle();
  }

  private restyle() {
    const p = PALETTE[this.time];
    for (const [id, e] of this.byId) {
      if (!e.polygon) continue;
      const fill = this.highlighted.has(id)
        ? p.districtHighlight
        : this.hovered === id
          ? p.districtHover
          : p.districtFill;
      e.polygon.material = new ColorMaterialProperty(fill);
      e.polygon.outlineColor = new ConstantProperty(
        this.highlighted.has(id) ? p.districtHighlight.withAlpha(1) : p.district,
      );
    }
  }

  /** Returns the district id for a picked entity, if it belongs to this layer. */
  districtIdForEntity(entity: unknown): string | null {
    if (!(entity instanceof Entity)) return null;
    for (const [id, e] of this.byId) if (e === entity) return id;
    return null;
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.restyle();
  }

  highlight(id: string | null, exclusive = true): void {
    if (exclusive) this.highlighted.clear();
    if (id) this.highlighted.add(id);
    this.restyle();
  }

  clearHighlight(): void {
    this.highlighted.clear();
    this.restyle();
  }

  /** Polygon hierarchy of a district (WGS84), e.g. for spatial queries. */
  hierarchy(id: string): PolygonHierarchy | undefined {
    return this.byId.get(id)?.polygon?.hierarchy?.getValue(this.viewer.clock.currentTime) as
      PolygonHierarchy | undefined;
  }

  setVisible(v: boolean): void {
    if (this.ds) this.ds.show = v;
  }
  setOpacity(o: number): void {
    for (const e of this.byId.values()) {
      if (!e.polygon) continue;
      const mat = e.polygon.material as ColorMaterialProperty;
      const c = mat.color?.getValue(this.viewer.clock.currentTime) as Color;
      if (c) e.polygon.material = new ColorMaterialProperty(c.withAlpha(c.alpha * o));
    }
  }
  applyTime(time: TimeOfDay): void {
    this.time = time;
    this.restyle();
  }
  onCameraChange(viewDistance: number): void {
    // Hide the fill when close to the ground so it does not tint the streets.
    if (!this.ds) return;
    const showFill = viewDistance > 6000;
    for (const e of this.byId.values()) if (e.polygon) e.polygon.fill = new ConstantProperty(showFill);
  }
  dispose(): void {
    if (this.ds) this.viewer.dataSources.remove(this.ds, true);
    this.ds = null;
    this.byId.clear();
  }
}
