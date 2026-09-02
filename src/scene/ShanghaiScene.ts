import type { Viewer } from 'cesium';
import { createViewer } from '../cesium/viewer';
import { CameraController } from '../cesium/camera';
import { LayerManager } from '../layers/LayerManager';
import { BoundaryLayer } from '../layers/BoundaryLayer';
import { WaterLayer } from '../layers/WaterLayer';
import { DistrictsLayer } from '../layers/DistrictsLayer';
import { RoadsLayer } from '../layers/RoadsLayer';
import { BuildingsLayer, type BuildingFilter } from '../layers/BuildingsLayer';
import { LandmarksLayer } from '../layers/LandmarksLayer';
import { MetroLayer } from '../layers/MetroLayer';
import { ParksLayer } from '../layers/ParksLayer';
import { ImageryLayer, TerrainLayer } from '../layers/ImageryTerrainLayers';
import { TimeController } from './time';
import { WeatherController } from './weather';
import { ThreeOverlay } from '../three/ThreeOverlay';
import { Interaction } from './interaction';
import { PerfMonitor } from '../utils/perf';
import { searchStatic, searchStreets, loadStreetIndex } from './search';
import { dataUrl } from '../config';
import type { FlyToTarget, SceneAPI } from './SceneAPI';
import type { CameraState, LayerId, PerfStats, SearchResult, Selection, TimeOfDay, Weather } from '../types';
import { findDistrict, findPlace, SHANGHAI_CENTER } from '../geo/shanghai';
import type { LonLatHeight } from '../geo/coordinates';

export interface SceneEvents {
  onLayerReport: (id: LayerId, patch: { loading?: boolean; error?: string; available?: boolean }) => void;
  onProgress: (message: string | null) => void;
  onSelect: (s: Selection | null) => void;
  onHoverDistrict: (id: string | null) => void;
  onCamera: (c: CameraState) => void;
  onPerf: (p: Partial<PerfStats>) => void;
  onTime: (t: TimeOfDay) => void;
  onWeather: (w: Weather) => void;
  onLayerVisibility: (id: LayerId, visible: boolean) => void;
}

/**
 * Owns the Cesium viewer, layers, camera, time, weather and interaction, and implements SceneAPI.
 * This is the ONLY object UI code (and later, AI agents) talk to.
 */
export class ShanghaiScene implements SceneAPI {
  readonly viewer: Viewer;
  readonly camera: CameraController;
  readonly layers: LayerManager;
  readonly time: TimeController;
  readonly weather: WeatherController;
  readonly overlay: ThreeOverlay;
  private interaction: Interaction;
  private perf: PerfMonitor;
  private cameraThrottle = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    private readonly events: SceneEvents,
  ) {
    this.viewer = createViewer(container);
    this.camera = new CameraController(this.viewer);
    this.overlay = new ThreeOverlay(this.viewer, container);
    this.time = new TimeController(this.viewer);
    this.weather = new WeatherController(this.viewer, this.overlay);
    this.layers = new LayerManager({
      viewer: this.viewer,
      camera: this.camera,
      report: events.onLayerReport,
    });
    this.layers
      .register(new TerrainLayer())
      .register(new ImageryLayer())
      .register(new BoundaryLayer())
      .register(new WaterLayer())
      .register(new DistrictsLayer())
      .register(new RoadsLayer())
      .register(new BuildingsLayer())
      .register(new LandmarksLayer())
      .register(new MetroLayer(), false)
      .register(new ParksLayer(), true);

    this.interaction = new Interaction(this.viewer, this.layers, {
      onSelect: (s) => {
        events.onSelect(s);
      },
      onHoverDistrict: events.onHoverDistrict,
    });

    this.camera.onChange((state) => {
      const now = performance.now();
      if (now - this.cameraThrottle < 100) return;
      this.cameraThrottle = now;
      events.onCamera(state);
      this.layers.onCameraChange(this.camera.getViewDistance());
    });

    this.perf = new PerfMonitor(this.viewer, (s) => {
      const b = this.layers.get<BuildingsLayer>('buildings');
      const stats = b?.stats() ?? { loaded: 0, loading: 0 };
      events.onPerf({
        fps: s.fps,
        frameMs: s.frameMs,
        jsHeapMB: s.jsHeapMB,
        tilesLoaded: stats.loaded,
        tilesLoading: stats.loading,
      });
    });

    // Start "from space" looking at Shanghai; App triggers the cinematic fly-in once layers are ready.
    console.info('[scene] created');
    this.camera.setView({ ...SHANGHAI_CENTER, height: 9_000_000 }, 0, -90);
    this.time.set('day');
  }

  /** Load layers in a sensible order: base first, buildings last so first paint is fast. */
  async initialize(): Promise<void> {
    const order: LayerId[] = [
      'terrain',
      'imagery',
      'boundary',
      'water',
      'parks',
      'districts',
      'roads',
      'buildings',
      'landmarks',
      'metro',
    ];
    await this.layers.initAll(order, (id) => this.events.onProgress(`Loading ${id}…`));
    if (this.disposed) return;
    void loadStreetIndex(dataUrl('geojson/streets-index.json'));
    this.events.onProgress(null);
    this.layers.onCameraChange(this.camera.getViewDistance());
  }

  // ------------------------------------------------------------------ SceneAPI

  async flyTo(target: FlyToTarget | string): Promise<void> {
    const t: FlyToTarget = typeof target === 'string' ? { target } : target;
    if (t.target) {
      const place = findPlace(t.target);
      if (place)
        return this.camera.flyToLandmark(place.id, {
          range: t.range,
          pitch: t.pitch,
          heading: t.heading,
          duration: t.duration,
        });
      const district = findDistrict(t.target);
      if (district)
        return this.camera.flyToDistrict(district.id, {
          range: t.range,
          pitch: t.pitch,
          heading: t.heading,
          duration: t.duration,
        });
      const results = this.search(t.target);
      if (results.length) return this.flyToSearchResult(results[0]);
      throw new Error(`Unknown target: ${t.target}`);
    }
    if (t.longitude !== undefined && t.latitude !== undefined) {
      // Without an explicit range, `height` is read as the camera altitude above the point (Google-Earth style).
      const range = t.range ?? t.height ?? 2000;
      const opts: Record<string, number | undefined> = {
        range,
        pitch: t.pitch ?? -60,
        heading: t.heading,
        duration: t.duration,
      };
      for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
      return this.camera.flyToCoordinates(
        { longitude: t.longitude, latitude: t.latitude, height: t.range !== undefined ? t.height : 0 },
        opts,
      );
    }
    throw new Error('flyTo needs a target name or coordinates');
  }

  flyToSearchResult(r: SearchResult): Promise<void> {
    if (r.kind === 'district') return this.camera.flyToDistrict(r.id.replace(/^district:/, ''));
    const place = findPlace(r.id);
    if (place) return this.camera.flyToLandmark(place.id);
    return this.camera.flyToCoordinates(r.position, {
      range: r.kind === 'station' ? 900 : r.kind === 'street' ? 1200 : 1500,
      pitch: r.kind === 'street' ? -50 : -40,
    });
  }

  flyToShanghai(): Promise<void> {
    return this.camera.flyToShanghai();
  }
  flyToDistrict(name: string): Promise<void> {
    return this.camera.flyToDistrict(name);
  }
  flyToLandmark(name: string): Promise<void> {
    return this.camera.flyToLandmark(name);
  }
  flyToCoordinates(
    p: LonLatHeight,
    opts?: { range?: number; pitch?: number; heading?: number },
  ): Promise<void> {
    return this.camera.flyToCoordinates(p, opts);
  }

  highlightDistrict(name: string | null): void {
    const layer = this.layers.get<DistrictsLayer>('districts');
    if (!layer) return;
    if (!name) return layer.clearHighlight();
    const d = findDistrict(name);
    layer.highlight(d?.id ?? null);
  }

  highlightBuildings(filter: BuildingFilter | null): void {
    this.layers.get<BuildingsLayer>('buildings')?.highlight(filter);
  }

  select(selection: Selection | null): void {
    this.events.onSelect(selection);
  }

  setTime(time: TimeOfDay): void {
    this.time.set(time);
    this.layers.applyTime(time);
    this.events.onTime(time);
  }

  setWeather(weather: Weather): void {
    this.weather.set(weather);
    // Re-apply time so fog/lighting presets compose predictably (weather overrides fog density).
    if (weather === 'clear') this.time.set(this.time.time);
    this.events.onWeather(weather);
  }

  showLayer(id: LayerId): void {
    this.layers.enable(id);
    this.events.onLayerVisibility(id, true);
  }
  hideLayer(id: LayerId): void {
    this.layers.disable(id);
    this.events.onLayerVisibility(id, false);
  }
  toggleLayer(id: LayerId): boolean {
    const v = this.layers.toggle(id);
    this.events.onLayerVisibility(id, v);
    return v;
  }
  setLayerOpacity(id: LayerId, opacity: number): void {
    this.layers.setOpacity(id, opacity);
  }
  listLayers(): LayerId[] {
    return this.layers.ids();
  }

  search(query: string): SearchResult[] {
    const results = searchStatic(query, 6);
    const metro = this.layers.get<MetroLayer>('metro');
    if (metro) for (const r of metro.search(query, 4)) if (results.length < 10) results.push(r);
    for (const r of searchStreets(query, 6)) if (results.length < 12) results.push(r);
    return results;
  }

  getCamera(): CameraState {
    return this.camera.getState();
  }

  async reset(): Promise<void> {
    this.highlightBuildings(null);
    this.highlightDistrict(null);
    this.setWeather('clear');
    this.setTime('day');
    this.events.onSelect(null);
    await this.camera.flyToShanghai();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.perf.dispose();
    this.interaction.dispose();
    this.weather.dispose();
    this.overlay.dispose();
    this.layers.dispose();
    this.viewer.destroy();
  }
}
