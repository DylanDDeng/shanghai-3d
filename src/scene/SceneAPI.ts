import type { LonLatHeight } from '../geo/coordinates';
import type { LayerId, SearchResult, Selection, TimeOfDay, Weather, CameraState } from '../types';
import type { BuildingFilter } from '../layers/BuildingsLayer';

export interface FlyToTarget {
  /** Place id / name (zh or en), district, or landmark — resolved via search index. */
  target?: string;
  longitude?: number;
  latitude?: number;
  height?: number;
  range?: number;
  pitch?: number;
  heading?: number;
  duration?: number;
}

/**
 * The stable, Cesium-free contract exposed to UI code and (in phase 3) to AI agents.
 * Every method is serializable-friendly: plain objects in, promises/plain objects out.
 */
export interface SceneAPI {
  flyTo(target: FlyToTarget | string): Promise<void>;
  flyToShanghai(): Promise<void>;
  flyToDistrict(name: string): Promise<void>;
  flyToLandmark(name: string): Promise<void>;
  flyToCoordinates(
    p: LonLatHeight,
    opts?: { range?: number; pitch?: number; heading?: number },
  ): Promise<void>;

  highlightDistrict(name: string | null): void;
  highlightBuildings(filter: BuildingFilter | null): void;
  select(selection: Selection | null): void;

  setTime(time: TimeOfDay): void;
  setWeather(weather: Weather): void;

  showLayer(id: LayerId): void;
  hideLayer(id: LayerId): void;
  toggleLayer(id: LayerId): boolean;
  setLayerOpacity(id: LayerId, opacity: number): void;
  listLayers(): LayerId[];

  search(query: string): SearchResult[];
  getCamera(): CameraState;
  reset(): Promise<void>;
}
