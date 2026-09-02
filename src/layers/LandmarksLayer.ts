import {
  Cartesian3,
  HeadingPitchRoll,
  Math as CesiumMath,
  Model,
  Transforms,
  Viewer,
  Color,
  Cesium3DTileset,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { dataUrl } from '../config';
import type { LandmarkDef, LandmarkSelection, TimeOfDay } from '../types';

/**
 * Individually modelled landmarks (glTF/GLB) placed by a JSON registry. Each entry carries its own
 * source/license metadata, and the registry doubles as the exclusion list for the procedural tileset
 * so footprints are not rendered twice. Any entry can later be swapped for a photogrammetry / BIM asset.
 */
export class LandmarksLayer implements Layer {
  readonly id = 'landmarks' as const;
  private viewer!: Viewer;
  private models = new Map<string, Model>();
  private defs: LandmarkDef[] = [];
  private visible = true;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const res = await fetch(dataUrl('models/landmarks/landmarks.json'));
    if (!res.ok) throw new Error(`landmarks.json HTTP ${res.status}`);
    this.defs = (await res.json()) as LandmarkDef[];
    const results = await Promise.allSettled(this.defs.map((d) => this.load(d)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === this.defs.length && this.defs.length > 0) {
      throw new Error(`all ${failed.length} landmark models failed to load`);
    }
    for (const r of failed) console.error('[landmarks] model failed', (r as PromiseRejectedResult).reason);
  }

  private async load(def: LandmarkDef): Promise<void> {
    const position = Cartesian3.fromDegrees(def.longitude, def.latitude, def.groundHeight ?? 0);
    const hpr = new HeadingPitchRoll(CesiumMath.toRadians(def.heading ?? 0), 0, 0);
    const modelMatrix = Transforms.headingPitchRollToFixedFrame(position, hpr);
    const model = await Model.fromGltfAsync({
      url: dataUrl(`models/landmarks/${def.model}`),
      modelMatrix,
      scale: def.scale ?? 1,
      id: { layer: 'landmark', landmarkId: def.id },
      allowPicking: true,
      minimumPixelSize: 0,
    });
    this.viewer.scene.primitives.add(model);
    model.show = this.visible;
    this.models.set(def.id, model);
  }

  definitions(): LandmarkDef[] {
    return this.defs;
  }

  /** Convert a pick result to a LandmarkSelection if it hit one of our models. */
  selectionFromPick(picked: unknown): LandmarkSelection | null {
    const p = picked as { id?: { layer?: string; landmarkId?: string }; primitive?: unknown } | undefined;
    const id = p?.id?.layer === 'landmark' ? p.id.landmarkId : undefined;
    if (!id) return null;
    const def = this.defs.find((d) => d.id === id);
    if (!def) return null;
    return {
      kind: 'landmark',
      id: def.id,
      name: def.name,
      nameEn: def.nameEn,
      height: def.height,
      built: def.built,
      description: def.description,
      position: { longitude: def.longitude, latitude: def.latitude, height: def.height },
    };
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const m of this.models.values()) m.show = v;
  }
  setOpacity(o: number): void {
    for (const m of this.models.values()) m.color = Color.WHITE.withAlpha(o);
  }
  applyTime(time: TimeOfDay): void {
    // Landmarks are lit by the scene light; at night we add a subtle self-illumination tint.
    for (const m of this.models.values()) {
      m.color = time === 'night' ? Color.fromCssColorString('#cfe3ff') : Color.WHITE;
      m.colorBlendAmount = time === 'night' ? 0.35 : 0;
    }
  }
  dispose(): void {
    for (const m of this.models.values()) this.viewer.scene.primitives.remove(m);
    this.models.clear();
  }

  /** Allows a landmark to be swapped at runtime for a 3D Tiles asset (photogrammetry / BIM). */
  async replaceWithTileset(id: string, tilesetUrl: string): Promise<void> {
    const m = this.models.get(id);
    if (m) {
      this.viewer.scene.primitives.remove(m);
      this.models.delete(id);
    }
    const ts = await Cesium3DTileset.fromUrl(tilesetUrl);
    this.viewer.scene.primitives.add(ts);
  }
}
