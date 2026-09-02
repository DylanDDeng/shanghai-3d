import { create } from 'zustand';
import type { CameraState, LayerId, LayerState, PerfStats, Selection, TimeOfDay, Weather } from '../types';

export interface AppState {
  ready: boolean;
  loadingMessage: string | null;
  fatalError: string | null;
  time: TimeOfDay;
  weather: Weather;
  layers: Record<LayerId, LayerState>;
  selection: Selection | null;
  hoveredDistrict: string | null;
  camera: CameraState;
  perf: PerfStats;
  panel: 'none' | 'search' | 'layers';
  // actions
  setReady: (ready: boolean) => void;
  setLoadingMessage: (msg: string | null) => void;
  setFatalError: (msg: string | null) => void;
  setTime: (t: TimeOfDay) => void;
  setWeather: (w: Weather) => void;
  patchLayer: (id: LayerId, patch: Partial<LayerState>) => void;
  setSelection: (s: Selection | null) => void;
  setHoveredDistrict: (id: string | null) => void;
  setCamera: (c: CameraState) => void;
  setPerf: (p: Partial<PerfStats>) => void;
  setPanel: (p: AppState['panel']) => void;
}

const LAYER_DEFS: Array<[LayerId, string, boolean]> = [
  ['terrain', 'Terrain', true],
  ['imagery', 'Imagery', true],
  ['boundary', 'City boundary', true],
  ['water', 'Water', true],
  ['districts', 'Districts', true],
  ['roads', 'Roads', true],
  ['buildings', 'Buildings', true],
  ['landmarks', 'Landmarks', true],
  ['metro', 'Metro', false],
  ['parks', 'Parks', true],
  ['poi', 'POI', false],
  ['traffic', 'Traffic', false],
];

const initialLayers = Object.fromEntries(
  LAYER_DEFS.map(([id, label, visible]) => [
    id,
    { id, label, visible, opacity: 1, available: true, loading: false } satisfies LayerState,
  ]),
) as Record<LayerId, LayerState>;

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  loadingMessage: 'Initializing…',
  fatalError: null,
  time: 'day',
  weather: 'clear',
  layers: initialLayers,
  selection: null,
  hoveredDistrict: null,
  camera: { longitude: 121.47, latitude: 31.23, height: 0, heading: 0, pitch: -90 },
  perf: { fps: 0, frameMs: 0, tilesLoaded: 0, tilesLoading: 0 },
  panel: 'none',
  setReady: (ready) => set({ ready }),
  setLoadingMessage: (loadingMessage) => set({ loadingMessage }),
  setFatalError: (fatalError) => set({ fatalError }),
  setTime: (time) => set({ time }),
  setWeather: (weather) => set({ weather }),
  patchLayer: (id, patch) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })),
  setSelection: (selection) => set({ selection }),
  setHoveredDistrict: (hoveredDistrict) => set({ hoveredDistrict }),
  setCamera: (camera) => set({ camera }),
  setPerf: (p) => set((s) => ({ perf: { ...s.perf, ...p } })),
  setPanel: (panel) => set({ panel }),
}));
