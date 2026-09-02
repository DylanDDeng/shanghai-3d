import {
  Color,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  Material,
  PolygonGeometry,
  Primitive,
  Viewer,
  buildModuleUrl,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import { iteratePolygons, loadGeoJson, polygonToHierarchy } from '../utils/geojson';
import { PALETTE } from './palette';
import type { TimeOfDay } from '../types';

/**
 * Huangpu River, Suzhou Creek and inner-city water bodies rendered with Cesium's animated water material
 * (normal-mapped ripples + specular). Not a flat blue polygon.
 */
export class WaterLayer implements Layer {
  readonly id = 'water' as const;
  private viewer!: Viewer;
  private primitive: Primitive | null = null;
  private material!: Material;
  private opacity = 1;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const fc = await loadGeoJson(dataUrl('geojson/water.geojson'));
    const instances: GeometryInstance[] = [];
    for (const f of fc.features) {
      for (const poly of iteratePolygons(f.geometry)) {
        const hierarchy = polygonToHierarchy(poly, 0);
        if (!hierarchy) continue;
        instances.push(
          new GeometryInstance({
            geometry: new PolygonGeometry({
              polygonHierarchy: hierarchy,
              height: 0.8,
              vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
            }),
            id: { layer: 'water', name: f.properties?.name },
          }),
        );
      }
    }
    this.material = Material.fromType('Water', {
      baseWaterColor: PALETTE.day.water,
      blendColor: PALETTE.day.waterBlend,
      normalMap: buildModuleUrl('Assets/Textures/waterNormals.jpg'),
      frequency: 1800.0,
      animationSpeed: 0.01,
      amplitude: 2.5,
      specularIntensity: 0.6,
      fadeFactor: 1.0,
    });
    this.primitive = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: instances,
        appearance: new EllipsoidSurfaceAppearance({
          material: this.material,
          aboveGround: true,
          translucent: false,
        }),
        asynchronous: true,
      }),
    );
  }

  setVisible(v: boolean): void {
    if (this.primitive) this.primitive.show = v;
  }
  setOpacity(o: number): void {
    this.opacity = o;
    const c = this.material.uniforms.baseWaterColor as Color;
    this.material.uniforms.baseWaterColor = Color.fromAlpha(c, o);
  }
  applyTime(time: TimeOfDay): void {
    const p = PALETTE[time];
    this.material.uniforms.baseWaterColor = Color.fromAlpha(p.water, this.opacity);
    this.material.uniforms.blendColor = p.waterBlend;
    this.material.uniforms.specularIntensity = time === 'night' ? 1.0 : time === 'sunset' ? 0.9 : 0.6;
    this.material.uniforms.amplitude = time === 'night' ? 3.5 : 2.5;
  }
  dispose(): void {
    if (this.primitive) this.viewer.scene.primitives.remove(this.primitive);
    this.primitive = null;
  }
}
