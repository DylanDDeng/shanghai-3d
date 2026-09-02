import {
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  Primitive,
  Viewer,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { geoJsonExists, iteratePolygons, loadGeoJson, polygonToHierarchy } from '../utils/geojson';
import { PALETTE } from './palette';
import type { TimeOfDay } from '../types';

/** Parks and green space (OSM leisure=park) as flat batched polygons. */
export class ParksLayer implements Layer {
  readonly id = 'parks' as const;
  private viewer!: Viewer;
  private primitive: Primitive | null = null;
  private hierarchies: ReturnType<typeof polygonToHierarchy>[] = [];
  private time: TimeOfDay = 'day';
  private opacity = 1;
  private visible = true;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const url = dataUrl('geojson/parks.geojson');
    if (!(await geoJsonExists(url))) throw new Error('parks.geojson not built (run npm run data:geojson)');
    const fc = await loadGeoJson(url);
    for (const f of fc.features)
      for (const poly of iteratePolygons(f.geometry)) this.hierarchies.push(polygonToHierarchy(poly, 0));
    this.build();
  }

  private build() {
    if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
    const base = PALETTE[this.time].park;
    const color = ColorGeometryInstanceAttribute.fromColor(base.withAlpha(base.alpha * this.opacity));
    const instances: GeometryInstance[] = [];
    for (const h of this.hierarchies) {
      if (!h) continue;
      instances.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: h,
            height: 0.4,
            vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: { color },
        }),
      );
    }
    this.primitive = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      }),
    );
    this.primitive!.show = this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (this.primitive) this.primitive.show = v;
  }
  setOpacity(o: number): void {
    this.opacity = o;
    if (this.hierarchies.length) this.build();
  }
  applyTime(time: TimeOfDay): void {
    if (time === this.time) return;
    this.time = time;
    if (this.hierarchies.length) this.build();
  }
  dispose(): void {
    if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
    this.primitive = null;
  }
}
