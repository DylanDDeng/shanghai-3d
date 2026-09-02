import type { Layer, LayerContext } from './Layer';
import type { LayerId, TimeOfDay } from '../types';

/** Cesium sometimes throws RuntimeErrors whose `message` is an object; always produce a readable string. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message as unknown;
    return typeof m === 'string' ? m : JSON.stringify(m);
  }
  return typeof e === 'string' ? e : JSON.stringify(e);
}

/**
 * Registry + lifecycle for all layers. Provides the enable/disable/toggle/opacity API used by the Scene API.
 */
export class LayerManager {
  private layers = new Map<LayerId, Layer>();
  private visibility = new Map<LayerId, boolean>();
  private opacity = new Map<LayerId, number>();
  private initialized = new Set<LayerId>();
  private time: TimeOfDay = 'day';
  private disposed = false;

  constructor(private readonly ctx: LayerContext) {}

  register(layer: Layer, visible = true): this {
    this.layers.set(layer.id, layer);
    this.visibility.set(layer.id, visible);
    this.opacity.set(layer.id, 1);
    return this;
  }

  has(id: LayerId): boolean {
    return this.layers.has(id);
  }

  get<T extends Layer = Layer>(id: LayerId): T | undefined {
    return this.layers.get(id) as T | undefined;
  }

  ids(): LayerId[] {
    return [...this.layers.keys()];
  }

  /** Initialize layers in the given order (or all registered). Failures are reported, not thrown. */
  async initAll(order?: LayerId[], onProgress?: (id: LayerId) => void): Promise<void> {
    const ids = order ?? this.ids();
    for (const id of ids) {
      if (this.disposed) return;
      const layer = this.layers.get(id);
      if (!layer || this.initialized.has(id)) continue;
      onProgress?.(id);
      this.ctx.report(id, { loading: true, error: undefined });
      try {
        await layer.init(this.ctx);
        if (this.disposed) {
          layer.dispose();
          return;
        }
        this.initialized.add(id);
        layer.setVisible(this.visibility.get(id) ?? true);
        layer.setOpacity(this.opacity.get(id) ?? 1);
        layer.applyTime?.(this.time);
        this.ctx.report(id, { loading: false });
      } catch (e) {
        const msg = errorMessage(e);
        console.error(`[layers] ${id} failed to initialize:`, e);
        this.ctx.report(id, { loading: false, error: msg, available: false });
      }
    }
  }

  enable(id: LayerId): void {
    this.setVisible(id, true);
  }
  disable(id: LayerId): void {
    this.setVisible(id, false);
  }
  toggle(id: LayerId): boolean {
    const next = !(this.visibility.get(id) ?? false);
    this.setVisible(id, next);
    return next;
  }
  isVisible(id: LayerId): boolean {
    return this.visibility.get(id) ?? false;
  }
  setVisible(id: LayerId, visible: boolean): void {
    this.visibility.set(id, visible);
    if (this.initialized.has(id)) this.layers.get(id)?.setVisible(visible);
  }
  setOpacity(id: LayerId, opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    this.opacity.set(id, o);
    if (this.initialized.has(id)) this.layers.get(id)?.setOpacity(o);
  }

  applyTime(time: TimeOfDay): void {
    this.time = time;
    for (const id of this.initialized) this.layers.get(id)?.applyTime?.(time);
  }

  onCameraChange(viewDistance: number): void {
    for (const id of this.initialized) this.layers.get(id)?.onCameraChange?.(viewDistance);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.initialized) {
      try {
        this.layers.get(id)?.dispose();
      } catch (e) {
        console.warn(`[layers] dispose ${id}:`, e);
      }
    }
    this.initialized.clear();
  }
}
