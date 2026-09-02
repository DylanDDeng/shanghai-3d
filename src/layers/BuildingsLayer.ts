import {
  Cesium3DTileFeature,
  Cesium3DTileStyle,
  Cesium3DTileset,
  Viewer,
  createOsmBuildingsAsync,
  Cartographic,
  Math as CesiumMath,
} from 'cesium';
import type { Layer, LayerContext } from './Layer';
import { config, dataUrl } from '../config';
import type { BuildingSelection, TimeOfDay } from '../types';

export interface BuildingFilter {
  height?: { gt?: number; lt?: number };
  type?: string;
  district?: string;
}

/**
 * City-wide buildings. Two possible sources, both Cesium3DTileset:
 *  - local: self-hosted 3D Tiles 1.1 built by scripts/process-buildings from OSM footprints (default)
 *  - ion:   Cesium OSM Buildings (asset 96188) — reference/prototype only, needs a token
 * Styling is done with Cesium3DTileStyle (GPU-evaluated), never per-feature JS loops.
 */
export class BuildingsLayer implements Layer {
  readonly id = 'buildings' as const;
  private viewer!: Viewer;
  private tilesets: Cesium3DTileset[] = [];
  private time: TimeOfDay = 'day';
  private opacity = 1;
  private filter: BuildingFilter | null = null;

  async init(ctx: LayerContext): Promise<void> {
    this.viewer = ctx.viewer;
    const mode = config.buildings;
    const errors: string[] = [];

    if (mode === 'local' || mode === 'both') {
      try {
        const ts = await Cesium3DTileset.fromUrl(dataUrl('tiles/buildings/tileset.json'), {
          maximumScreenSpaceError: 12,
          skipLevelOfDetail: false,
          cullRequestsWhileMoving: true,
          cullRequestsWhileMovingMultiplier: 30,
          preloadWhenHidden: false,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 0.0003,
          dynamicScreenSpaceErrorFactor: 6,
          cacheBytes: 384 * 1024 * 1024,
          maximumCacheOverflowBytes: 256 * 1024 * 1024,
          showCreditsOnScreen: false,
        });
        this.viewer.scene.primitives.add(ts);
        this.tilesets.push(ts);
      } catch (e) {
        console.error('[buildings] local tileset failed', e);
        errors.push(`local tileset: ${(e as Error).message}`);
      }
    }
    if (mode === 'ion' || mode === 'both') {
      if (!config.ionToken) errors.push('ion buildings: VITE_CESIUM_ION_TOKEN missing');
      else {
        try {
          const ts = await createOsmBuildingsAsync({ showOutline: false });
          this.ionTilesets.add(ts);
          this.viewer.scene.primitives.add(ts);
          this.tilesets.push(ts);
        } catch (e) {
          errors.push(`ion buildings: ${(e as Error).message}`);
        }
      }
    }
    if (this.tilesets.length === 0) throw new Error(errors.join('; ') || 'no building source configured');
    if (errors.length) console.warn('[buildings]', errors.join('; '));
    this.restyle();
  }

  get primary(): Cesium3DTileset | undefined {
    return this.tilesets[0];
  }

  /** Tile loading statistics for the perf HUD. */
  stats(): { loaded: number; loading: number } {
    let loaded = 0;
    let loading = 0;
    for (const ts of this.tilesets) {
      const s = (
        ts as unknown as {
          statistics?: {
            numberOfTilesWithContentReady: number;
            numberOfPendingRequests: number;
            numberOfTilesProcessing: number;
          };
        }
      ).statistics;
      if (s) {
        loaded += s.numberOfTilesWithContentReady;
        loading += s.numberOfPendingRequests + s.numberOfTilesProcessing;
      }
    }
    return { loaded, loading };
  }

  // ---------------------------------------------------------------- styling

  /** Height property differs per source: self-hosted tiles use `height`, Cesium OSM Buildings `cesium#estimatedHeight`. */
  private heightExprFor(ts: Cesium3DTileset): string {
    return this.ionTilesets.has(ts) ? "Number(${feature['cesium#estimatedHeight']})" : 'Number(${height})';
  }
  private ionTilesets = new WeakSet<Cesium3DTileset>();

  private filterExpr(h: string): string | null {
    if (!this.filter) return null;
    const parts: string[] = [];
    if (this.filter.height?.gt !== undefined) parts.push(`${h} > ${this.filter.height.gt}`);
    if (this.filter.height?.lt !== undefined) parts.push(`${h} < ${this.filter.height.lt}`);
    if (this.filter.type)
      parts.push(`regExp('${this.filter.type.replace(/'/g, '')}', 'i').test(String(\${building}))`);
    if (this.filter.district)
      parts.push(`String(\${district}) === '${this.filter.district.replace(/'/g, '')}'`);
    return parts.length ? parts.join(' && ') : null;
  }

  private restyle() {
    for (const ts of this.tilesets) ts.style = this.styleFor(this.heightExprFor(ts));
  }

  private styleFor(h: string): Cesium3DTileStyle {
    const a = this.opacity.toFixed(3);
    const dim = (0.18 * this.opacity).toFixed(3);
    const f = this.filterExpr(h);
    // Height-graded colors per time of day. Night uses warm "lit window" tones so towers glow.
    const ramp: Record<TimeOfDay, [string, string, string, string, string]> = {
      day: ['#f4f6f8', '#dfe5ec', '#c7d3df', '#a9bdd1', '#8bb0d6'],
      sunset: ['#f7d9c4', '#f0c2a5', '#e2a888', '#cf8f78', '#b47b75'],
      night: ['#2d3f5b', '#3a5178', '#4d6a99', '#6f8fc2', '#9fc1ec'],
    };
    const [c0, c1, c2, c3, c4] = ramp[this.time];
    const highlight = this.time === 'night' ? '#ffd166' : '#ff9f43';
    const conditions: [string, string][] = [];
    if (f) {
      conditions.push([f, `color('${highlight}', ${a})`]);
      conditions.push(['true', `color('${c1}', ${dim})`]);
    } else {
      conditions.push([`${h} > 300`, `color('${c4}', ${a})`]);
      conditions.push([`${h} > 150`, `color('${c3}', ${a})`]);
      conditions.push([`${h} > 60`, `color('${c2}', ${a})`]);
      conditions.push([`${h} > 25`, `color('${c1}', ${a})`]);
      conditions.push(['true', `color('${c0}', ${a})`]);
    }
    return new Cesium3DTileStyle({ color: { conditions } });
  }

  /** Highlight buildings matching a filter (others are dimmed). Pass null to clear. */
  highlight(filter: BuildingFilter | null): void {
    this.filter = filter;
    this.restyle();
  }

  // ---------------------------------------------------------------- picking

  /** Map a Cesium pick result to a BuildingSelection, or null if it is not one of our features. */
  selectionFromPick(
    picked: unknown,
    worldPosition?: { longitude: number; latitude: number },
  ): BuildingSelection | null {
    if (!(picked instanceof Cesium3DTileFeature)) return null;
    const get = (k: string) => picked.getProperty(k) as unknown;
    const num = (v: unknown) =>
      v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
    const height = num(get('height')) ?? num(get('cesium#estimatedHeight')) ?? 0;
    const levels = num(get('levels')) ?? num(get('building:levels'));
    const id = (get('id') ?? get('osm_id') ?? get('elementId') ?? picked.featureId) as string | number;
    const name = (get('name') as string | undefined) || undefined;
    let position = worldPosition;
    if (!position) {
      const lon = num(get('lon'));
      const lat = num(get('lat'));
      if (lon !== undefined && lat !== undefined) position = { longitude: lon, latitude: lat };
    }
    return {
      kind: 'building',
      id,
      name,
      height,
      levels,
      type: (get('building') as string | undefined) || (get('type') as string | undefined) || undefined,
      district: (get('district') as string | undefined) || undefined,
      heightSource: (get('height_source') as string | undefined) || undefined,
      source: (get('source') as string | undefined) || undefined,
      position,
    };
  }

  setVisible(v: boolean): void {
    for (const ts of this.tilesets) ts.show = v;
  }
  setOpacity(o: number): void {
    this.opacity = o;
    this.restyle();
  }
  applyTime(time: TimeOfDay): void {
    this.time = time;
    this.restyle();
  }
  dispose(): void {
    for (const ts of this.tilesets) this.viewer.scene.primitives.remove(ts);
    this.tilesets = [];
  }

  /** Utility for callers that have a Cartesian3 hit position. */
  static cartographic(c: import('cesium').Cartesian3): { longitude: number; latitude: number } {
    const carto = Cartographic.fromCartesian(c);
    return {
      longitude: CesiumMath.toDegrees(carto.longitude),
      latitude: CesiumMath.toDegrees(carto.latitude),
    };
  }
}
