# Architecture

Shanghai 3D is a data-driven 3D city engine, not a single scene file. Every visual element is a **layer** fed by
**self-hosted, pre-processed open data**, placed on a CesiumJS globe, and driven through one **Scene API**.

```
                ┌────────────────────────── UI (React HUD) ──────────────────────────┐
                │  Search · Layers · Day/Night · Weather · Stats · Zoom · InfoPanel │
                └───────────────────────────────┬────────────────────────────────────┘
                                                │  SceneAPI (src/scene/SceneAPI.ts)
                                                ▼
   ┌───────────────────────────── ShanghaiScene (src/scene/ShanghaiScene.ts) ─────────────────────────────┐
   │ CameraController · LayerManager · TimeController · WeatherController · Interaction · PerfMonitor    │
   └────────┬───────────────┬────────────────────┬────────────────────────┬───────────────────────────────┘
            │               │                    │                        │
      Cesium Viewer    Layers (src/layers)   Three.js overlay        Zustand store (UI state)
      globe/camera     terrain imagery       rain / snow / fx        camera · perf · selection
      3D Tiles         water roads parks
                       districts buildings
                       landmarks metro
```

## Principles

1. **WGS84 everywhere.** `src/geo/coordinates.ts` is the only conversion module. GCJ-02/BD-09 helpers exist for
   ingesting Chinese-sourced data but never for internal state. Place coordinates were resolved from OSM with
   `scripts/validate-data/lookup-places.ts`; memorised coordinates turned out to be GCJ-02 shifted, and the
   validator now fails on anything outside the municipality.
2. **No Shanghai.glb.** Buildings are a 3D Tiles 1.1 tileset with three LOD levels (see DATA_PIPELINE.md).
   Cesium streams only the tiles whose screen-space error demands it; the rest never leaves the CDN.
3. **Layers own their Cesium objects.** Nothing outside `src/layers` creates entities or primitives. A layer
   implements `init / setVisible / setOpacity / applyTime / onCameraChange / dispose` (`src/layers/Layer.ts`).
   `LayerManager` orders initialisation, reports loading/error state to the store and fans out time/camera events.
4. **One camera owner.** `src/cesium/camera.ts` is the only code touching `viewer.camera`; it derives cinematic
   durations from travel distance and exposes `flyToShanghai / flyToDistrict / flyToLandmark / flyToCoordinates`.
5. **Scene API is the product.** `SceneAPI` is Cesium-free and serialisable (plain objects in, promises out):
   `flyTo`, `highlightDistrict`, `highlightBuildings({height:{gt:300}})`, `setTime`, `setWeather`,
   `showLayer/hideLayer/toggleLayer/setLayerOpacity`, `search`, `reset`. It is exposed as `window.Shanghai`
   for tooling and is the surface an AI agent will call in phase 3.
6. **Cesium for GIS, Three.js for effects.** `src/three/ThreeOverlay.ts` syncs a transparent Three.js camera to
   Cesium each frame in an ECEF floating-origin frame; precipitation lives in an East-North-Up group at the camera.
   Three.js never renders GIS content.
7. **Everything replaceable.** Landmarks are a JSON registry (`public/models/landmarks/landmarks.json`) with
   per-entry source/license metadata; any entry can be swapped for a photogrammetry or BIM asset
   (`LandmarksLayer.replaceWithTileset`). The building tileset can be regenerated from Overture or a PBF export
   without touching the app. Imagery/terrain/building sources are chosen by env vars (`.env.example`).

## Runtime flow

1. `useShanghai` creates `ShanghaiScene` (viewer from space, day lighting) and calls `initialize()`.
2. Layers load in order `terrain → imagery → boundary → water → parks → districts → roads → buildings → landmarks → metro`
   so the first paint (river, roads, districts) appears before building tiles start streaming.
3. Cinematic entry: space → municipality (4.5 s) → inner city (3.5 s).
4. Camera changes (throttled to 10 Hz) drive layer LOD: roads buckets show by view distance, district fills hide
   below 6 km, imagery fades out below ~25 km so the dark "digital twin" ground and vector layers take over.
5. Picking (`src/scene/interaction.ts`) maps a Cesium pick to a typed `Selection` (building / landmark /
   district / station) consumed by the info panel.

## Coordinate & tile conventions

- Tile content GLBs are in a local East-North-Up frame at the tile centre, written glTF y-up
  (`x = east, y = up, z = -north`). The tile `transform` is the ENU→ECEF frame; **child transforms are
  parent-relative** (3D Tiles semantics) — the pipeline multiplies by the inverse of the parent's frame.
- Bounding volumes are geographic `region`s (always absolute, unaffected by transforms).
- Per-building metadata travels in `EXT_structural_metadata` property tables (id, name, height, levels, type,
  district, height_source, area, lon, lat) and feature IDs in `_FEATURE_ID_0` / `EXT_mesh_features`, so
  `Cesium3DTileStyle` expressions and picking work without any JS per-feature loops.

## Extension points

| Future need                 | Where it plugs in                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Photogrammetry for Lujiazui | another `Cesium3DTileset` in `BuildingsLayer` (or `LandmarksLayer.replaceWithTileset`) plus an exclusion polygon in the pipeline |
| BIM for one building        | landmark registry entry with `model` = glTF exported from IFC                                                                    |
| Real-time traffic           | new `TrafficLayer` (roads GeoJSON already carries `highway` class); trails via the Three overlay                                 |
| Weather API                 | `WeatherController.set()` is the single entry point                                                                              |
| Population / business data  | style expressions in `BuildingsLayer` + a metadata join in the pipeline                                                          |
| AI agent                    | call `window.Shanghai` (SceneAPI) — no Cesium knowledge needed                                                                   |
| Backend (PostGIS/FastAPI)   | replace static GeoJSON fetches in `src/utils/geojson.ts` with API calls; tiles stay static on a CDN                              |
