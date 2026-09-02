import {
  GeometryInstance,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  ColorGeometryInstanceAttribute,
  Viewer,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { iterateLines, lineToCartesians, loadGeoJson } from '../utils/geojson';
import { paletteColor } from './palette';
import type { TimeOfDay } from '../types';

/** Shanghai municipal boundary outline. */
export class BoundaryLayer implements Layer {
  readonly id = 'boundary' as const;
  private viewer!: Viewer;
  private primitive: Primitive | null = null;
  private instances: GeometryInstance[] = [];
  private time: TimeOfDay = 'day';

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const fc = await loadGeoJson(dataUrl('geojson/shanghai-boundary.geojson'));
    for (const f of fc.features) {
      for (const line of iterateLines(f.geometry)) {
        if (line.length < 2) continue;
        this.instances.push(
          new GeometryInstance({
            geometry: new PolylineGeometry({ positions: lineToCartesians(line, 5), width: 2.5 }),
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(paletteColor(this.time, 'boundary')),
            },
          }),
        );
      }
    }
    this.build();
  }

  private build() {
    if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
    this.primitive = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: this.instances.map(
          (i) =>
            new GeometryInstance({
              geometry: i.geometry,
              attributes: {
                color: ColorGeometryInstanceAttribute.fromColor(paletteColor(this.time, 'boundary')),
              },
            }),
        ),
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
      }),
    );
  }

  setVisible(v: boolean): void {
    if (this.primitive) this.primitive.show = v;
  }
  setOpacity(): void {
    /* outline: opacity handled by palette */
  }
  applyTime(time: TimeOfDay): void {
    if (time === this.time) return;
    this.time = time;
    if (this.instances.length) {
      const show = this.primitive?.show ?? true;
      this.build();
      this.primitive!.show = show;
    }
  }
  dispose(): void {
    if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
    this.primitive = null;
  }
}
