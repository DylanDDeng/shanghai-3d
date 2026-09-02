import type { LonLatHeight } from '../geo/coordinates';

export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'rain' | 'snow' | 'fog';

export type LayerId =
  | 'terrain'
  | 'imagery'
  | 'boundary'
  | 'buildings'
  | 'landmarks'
  | 'roads'
  | 'metro'
  | 'districts'
  | 'water'
  | 'parks'
  | 'poi'
  | 'traffic';

export interface LayerState {
  id: LayerId;
  label: string;
  visible: boolean;
  opacity: number;
  /** false when the layer's data is unavailable in this build */
  available: boolean;
  loading: boolean;
  error?: string;
}

export interface BuildingSelection {
  kind: 'building';
  id: string | number;
  name?: string;
  height: number;
  levels?: number;
  type?: string;
  district?: string;
  heightSource?: string;
  /** osm | overture:<dataset> */
  source?: string;
  position?: LonLatHeight;
}

export interface LandmarkSelection {
  kind: 'landmark';
  id: string;
  name: string;
  nameEn: string;
  height: number;
  built?: string;
  description?: string;
  position: LonLatHeight;
}

export interface DistrictSelection {
  kind: 'district';
  id: string;
  name: string;
  nameEn: string;
}

export interface StationSelection {
  kind: 'station';
  name: string;
  lines: string[];
  position: LonLatHeight;
}

export type Selection = BuildingSelection | LandmarkSelection | DistrictSelection | StationSelection;

export interface CameraState {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
}

export interface PerfStats {
  fps: number;
  frameMs: number;
  tilesLoaded: number;
  tilesLoading: number;
  jsHeapMB?: number;
  gpuMemoryMB?: number;
  drawCalls?: number;
}

export interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  kind: 'landmark' | 'area' | 'street' | 'station' | 'district';
  position: LonLatHeight;
}

/** Landmark registry entry (public/models/landmarks/landmarks.json). */
export interface LandmarkDef {
  id: string;
  name: string;
  nameEn: string;
  longitude: number;
  latitude: number;
  /** Ground elevation offset (m) applied to the model origin. */
  groundHeight?: number;
  height: number;
  built?: string;
  description?: string;
  model: string; // relative to public/models/landmarks/
  heading?: number; // degrees, rotation about up axis
  scale?: number;
  source: string;
  license: string;
  /** Footprints within this radius (m) of the landmark are excluded from the procedural tileset. */
  exclusionRadius?: number;
  /** OSM way/relation ids of the footprint(s) to exclude from the procedural tileset. */
  osmIds?: number[];
}
