import type { ImageryLayer as CesiumImageryLayer, Viewer } from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { createImagery, tuneImagery, type ImageryChoice } from '../cesium/imagery';
import { applyTerrain } from '../cesium/terrain';
import type { TimeOfDay } from '../types';

/** Base imagery wrapper so imagery participates in the LayerManager like everything else. */
export class ImageryLayer implements Layer {
  readonly id = 'imagery' as const;
  private choice: ImageryChoice = { layer: null, nightLayer: null, attribution: '' };
  private visible = true;
  private time: TimeOfDay = 'day';
  attribution = '';

  async init(ctx: LayerContext): Promise<void> {
    this.choice = await createImagery(ctx.viewer);
    this.attribution = this.choice.attribution;
    if (!this.choice.layer) ctx.report(this.id, { available: false });
  }
  get layer(): CesiumImageryLayer | null {
    return this.choice.layer;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    if (this.choice.layer) this.choice.layer.show = v;
    if (this.choice.nightLayer) this.choice.nightLayer.show = v && this.time !== 'day';
  }
  private opacity = 1;
  setOpacity(o: number): void {
    this.opacity = o;
    this.applyAlpha();
  }
  private viewDistance = 1e7;
  /** Global imagery is ~600 m/px: show it from afar, fade to the dark ground (vector layers) at city scale. */
  private applyAlpha() {
    const t = Math.min(1, Math.max(0, (this.viewDistance - 25_000) / 120_000)); // 0 @25 km → 1 @145 km
    const eased = t * t * (3 - 2 * t);
    if (this.choice.layer) this.choice.layer.alpha = this.opacity * (0.15 + 0.85 * eased);
    if (this.choice.nightLayer)
      this.choice.nightLayer.alpha =
        this.opacity * (this.time === 'night' ? 0.85 : 0.35) * (0.2 + 0.8 * eased);
  }
  onCameraChange(viewDistance: number): void {
    this.viewDistance = viewDistance;
    this.applyAlpha();
  }
  applyTime(time: TimeOfDay): void {
    this.time = time;
    tuneImagery(this.choice, time);
    this.setVisible(this.visible);
    this.applyAlpha();
  }
  dispose(): void {
    /* viewer owns the imagery collection */
  }
}

export class TerrainLayer implements Layer {
  readonly id = 'terrain' as const;
  private viewer!: Viewer;
  providerName = '';

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    this.providerName = await applyTerrain(ctx.viewer);
  }
  setVisible(v: boolean): void {
    this.viewer.scene.globe.show = v;
  }
  setOpacity(o: number): void {
    this.viewer.scene.globe.translucency.enabled = o < 1;
    this.viewer.scene.globe.translucency.frontFaceAlpha = o;
  }
  dispose(): void {
    /* nothing */
  }
}
