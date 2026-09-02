# Shanghai 3D

An open-data, data-driven 3D city browser for Shanghai — CesiumJS + Three.js + React + TypeScript. Fly from the
whole municipality down to Lujiazui, the Bund or any street: 2.39 M extruded buildings across all 16 districts (OSM + Overture)
streamed as quantized 3D Tiles, 258 k road segments down to footpaths with street-name labels, the Huangpu River
and 6.5 k water bodies with animated water, districts, metro, parks and procedural landmark models; switch
day/sunset/night and weather, click any building — and drive all of it through one Scene API built for AI agents.

![status](https://img.shields.io/badge/phase-1%20MVP-blue)

## Quick start

```bash
npm install
cp .env.example .env.local        # everything optional; runs fully self-hosted without tokens
npm run data:all                  # Overpass (boundary/districts/metro) + Geofabrik PBF extract (needs osmium-tool:
                                  # brew install osmium-tool) → GeoJSON, road grid, landmarks, 3D Tiles, validate
npm run dev                       # http://localhost:5173
```

Already have `public/` data? Just `npm run dev`. `npm run build` produces a static `dist/` (serve `public/tiles`
etc. from a CDN and set `VITE_DATA_BASE_URL` for production).

## What works (Phase 1 MVP)

* Globe → Shanghai → inner city cinematic fly-in; free zoom/rotate/tilt; zoom & tilt controls
* City boundary, 16 districts (hover / highlight / click / fly-to, labels), Huangpu River + Suzhou Creek + 870
  water bodies with Cesium's animated water material, parks
* Roads city-wide in six LOD classes (motorway/trunk → primary → secondary/tertiary → residential/pedestrian →
  service → footpaths): major roads always resident, the rest streamed in 0.06° cells around the camera, with
  street-name labels below 2.6 km and emissive night colours
* Buildings: 2.39 M footprints — every OSM building (196 k, authoritative) plus 2.19 M Overture footprints
  (Shi et al. 2023 East Asia dataset, CC BY 4.0) where OSM has none — as self-hosted, KHR_mesh_quantization
  3D Tiles 1.1 (1.6 GB, 7.6 k tiles; heights from OSM `height` / `building:levels`, else the CNBH-10m 10 m height
  raster, else typed estimates), height-graded
  colours, GPU styling, `highlightBuildings({ height: { gt: 300 } })`, per-building data source in the info panel
* Landmarks: Shanghai Tower, Oriental Pearl, Jin Mao, SWFC, IFC Tower 2, Shanghai Exhibition Center
  (procedural GLBs with metadata; replaceable per entry)
* Metro lines (brand colours) and 256 stations with labels, hover/click, searchable (layer off by default)
* Search (zh/en/aliases): landmarks, areas, 16 districts, 256 metro stations and 10.7 k named streets (淮海中路, 西藏南路 …)
* Day / sunset / night (sun position + lighting presets + NASA Black Marble city lights), weather: clear /
  rain / snow (Three.js particles) / fog
* Click building → height, floors, type, district, OSM id; click landmark → name, height, built, description
* HUD: FPS, frame time, tiles loaded, heap, altitude, lon/lat, heading/pitch
* `window.Shanghai` — the Scene API (`flyTo`, `highlightDistrict`, `setTime`, `setWeather`, `showLayer`, `search`, …)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `preview` | Vite app |
| `npm run lint` / `typecheck` / `format` | ESLint (flat config) · tsc strict · Prettier |
| `npm run data:download` | Overpass downloads (boundary, districts, metro) → `data/raw/` |
| `npm run data:geojson` | → boundary / districts / metro GeoJSON |
| `npm run data:extract` | osmium: China PBF → Shanghai buildings/highways/water/parks GeoJSONSeq |
| `npm run data:pbf` | → `roads-major`, `roads/` grid, `streets-index`, `water`, `parks` |
| `npm run data:landmarks` | → `public/models/landmarks/` |
| `npm run data:overture` | DuckDB bbox query of Overture buildings → `data/raw/overture/` (needs `brew install duckdb`) |
| `npm run data:cnbh` | CNBH-10m height raster tiles → `data/raw/cnbh/` |
| `npm run data:buildings:city` | whole municipality, OSM + Overture merge → `public/tiles/buildings/` (3D Tiles 1.1, quantized) |
| `npm run data:buildings` | same from the Overpass grid cells (inner city only) |
| `npm run data:validate` | bbox / tileset / GLB checks |

## Configuration (`.env.example`)

| Var | Values | Default |
|---|---|---|
| `VITE_IMAGERY` | `gibs` (NASA, keyless) · `carto-dark/light` (needs `VITE_CARTO_API_KEY`) · `osm` (dev only) · `custom` (`VITE_IMAGERY_URL`) · `ion-bing` · `none` | `gibs` |
| `VITE_TERRAIN` | `ellipsoid` · `ion` · `local` | `ellipsoid` |
| `VITE_BUILDINGS` | `local` · `ion` (Cesium OSM Buildings, reference only) · `both` | `local` |
| `VITE_CESIUM_ION_TOKEN` | optional | — |
| `VITE_DATA_BASE_URL` | CDN/bucket base for `tiles/`, `models/`, `geojson/` | same origin |

## Repository layout

```
src/app          React entry, scene hook            scripts/download-osm      Overpass client + datasets
src/components   HUD                                scripts/process-geojson   raw → GeoJSON
src/cesium       viewer, camera, imagery, terrain   scripts/process-buildings OSM → 3D Tiles pipeline
src/layers       Layer interface + all layers       scripts/build-landmarks   procedural landmark GLBs
src/scene        ShanghaiScene, SceneAPI, time,     scripts/process-dem       Copernicus DEM → terrain
                 weather, interaction, search       scripts/validate-data     validators + lookup tools
src/three        Three.js overlay + precipitation   scripts/lib               Overpass, GLB writer, geometry
src/geo          WGS84 utils, Shanghai constants    public/{tiles,models,geojson,terrain}  generated data
src/stores       Zustand store                      docs/                     ARCHITECTURE, DATA_SOURCES,
src/types        shared types                                                 DATA_PIPELINE, PERFORMANCE
```

## Docs

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, Scene API, coordinate/tile conventions, extension points
* [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — every candidate source, license, verdict, attribution text
* [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) — download → clean → heights → tiles → validate
* [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — budgets, techniques, monitoring, next optimisations

## Roadmap

* **Phase 2** — cross-check tower heights (CNBH saturates above ~60 m), roof shapes,
  facades & night windows, POI, road surfaces from `lanes`/`width`, advanced water, traffic trails, more landmarks,
  CDN hosting of the 1.6 GB tileset (`VITE_DATA_BASE_URL`)
* **Phase 3** — AI agent control: natural language → `Shanghai.*` calls

## Attribution

Map data © OpenStreetMap contributors (ODbL 1.0). Imagery: NASA GIBS Blue Marble / Black Marble (public domain).
Building footprints also from Overture Maps (ODbL) incl. Shi et al. 2023 East Asian buildings (CC BY 4.0); building heights from CNBH-10m, Wu et al. 2023 (CC BY 4.0). Terrain (optional): Copernicus DEM © ESA/DLR/Airbus. Built with CesiumJS (Apache-2.0) and Three.js (MIT).
