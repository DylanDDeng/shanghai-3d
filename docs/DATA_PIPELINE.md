# Data pipeline

All data is fetched, processed and validated by Node/TypeScript scripts (no GDAL required). Raw downloads live in
`data/raw/` (git-ignored); processed outputs go to `public/` and are what the app (or a CDN) serves.

```
npm run data:download    scripts/download-osm/download.ts        Overpass → data/raw/*.osm.json (boundary, districts, metro, inner grid)
npm run data:geojson     scripts/process-geojson/process.ts      raw Overpass → boundary / districts / metro GeoJSON
npm run data:extract     scripts/download-osm/extract-pbf.sh     Geofabrik china-latest.osm.pbf → Shanghai *.geojsonseq (osmium)
npm run data:pbf         scripts/process-geojson/process-pbf.ts  geojsonseq → roads-major, roads/{cell}.geojson + index, streets-index, water, parks
npm run data:landmarks   scripts/build-landmarks/build-landmarks.ts → public/models/landmarks/*.glb + landmarks.json
npm run data:buildings:city  build-shanghai-buildings.ts --input=data/raw/pbf → public/tiles/buildings/ (whole municipality)
npm run data:validate    scripts/validate-data/validate.ts       sanity checks (bbox, tileset, GLBs)
npm run data:all         everything above in order
```

## 1. Download (`scripts/download-osm`)

Overpass API with endpoint rotation, retries, a proper `User-Agent` (overpass-api.de returns 406 without one) and
on-disk caching. Datasets:

| Name                                       | Query                                                       | Notes                                                       |
| ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| shanghai-boundary                          | admin_level=4 relation 上海市                               | includes exclave farms in Jiangsu/Anhui + maritime boundary |
| districts                                  | admin_level=6 relations inside 上海市                       | 16 districts                                                |
| water-huangpu / water-rivers / water-inner | natural=water (river/canal corridor + all inner-city water) | Huangpu is many unnamed `water=river` polygons              |
| roads-major                                | motorway/trunk/primary city-wide                            | far LOD                                                     |
| roads-inner                                | secondary/tertiary in the inner extent                      | near LOD                                                    |
| metro-lines / metro-stations               | route=subway relations, station=subway nodes                |                                                             |
| parks-inner                                | leisure=park                                                |                                                             |
| buildings-<lon>_<lat>                      | building + building:part, 0.06° grid cells                  | 30 cells cover `INNER_BBOX` (121.32–121.68, 31.10–31.36)    |

To extend coverage to the whole municipality, enlarge `BUILDING_EXTENT` or switch the input to a Geofabrik PBF
exported with `osmium export` — the building pipeline also accepts `*.geojson` files in `data/raw/`.

## 1b. Whole-municipality extract (`scripts/download-osm/extract-pbf.sh`)

Overpass cannot serve the whole city, so production data comes from the Geofabrik China extract
(`china-latest.osm.pbf`, ~1.6 GB) clipped with `osmium extract` to 120.85–122.25 / 30.65–31.90 (`complete_ways`),
then `osmium tags-filter` + `osmium export -f geojsonseq --add-unique-id=type_id` per theme. 2026-09-01 counts:
198 005 building polygons, 258 524 highway ways, 6 952 water polygons, 3 367 parks. osmium area ids are
`a<way_id*2>` / `a<rel_id*2+1>`; the pipelines decode them back to OSM way/relation ids.

## 2. GeoJSON processing (`scripts/process-geojson`)

`osmtogeojson` → Turf cleanup → coordinate truncation (5–6 decimals) → light simplification. District and
boundary multipolygons drop rings outside the contiguous municipality (the exclave farms), and each district gets
a curated WGS84 `center` (centroids of Pudong/Chongming fall in the sea). Metro station→line membership is
recovered spatially (stations within 60 m of a line).

## 2b. Overture Maps footprints (`scripts/download-osm/download-overture.sh`)

DuckDB (`brew install duckdb`) queries the public Overture S3 release by bbox and writes
`data/raw/overture/buildings.geojsonseq` with `id, height, num_floors, class, subtype, name, source`. The building
pipeline loads it automatically (skip with `--no-overture`): features whose `source` is OpenStreetMap are ignored
(already present), and the remaining footprints — in Shanghai these are the Shi et al. 2023 East Asian building
dataset (`doi:10.5281/zenodo.8174931`, CC BY 4.0) — are added only where no OSM building overlaps (centroid-in-polygon
both ways plus a 30 % bbox-overlap test via a grid index). Every building carries a `source` property
(`osm` or `overture:<dataset>`), shown in the info panel.

## 2c. CNBH-10m heights (`scripts/download-osm/download-cnbh.sh`)

Downloads the 2°×2° UTM-51N GeoTIFF tiles `CNBH10m_X121Y31` (335 MB) and `CNBH10m_X123Y31` from Zenodo
record 7923866 into `data/raw/cnbh/`; the building pipeline samples them automatically (skip with `--no-cnbh`).

## 3. Buildings → 3D Tiles (`scripts/process-buildings`)

1. **Load** all `buildings-*.osm.json`, de-duplicate across cell overlaps, split `building` vs `building:part`.
2. **Clean**: drop degenerate rings, `unkinkPolygon` self-intersections, drop < 8 m², skip outlines that contain
   `building:part`s (the parts carry the detail), drop footprints near registered landmarks.
3. **Heights**: `height` (m/ft parsed) → `building:levels (+roof:levels)` × per-type floor height
   (residential 3.0, commercial 3.9, industrial 5.0, civic 3.8, default 3.2) → **CNBH-10m raster sample**
   (`scripts/lib/raster.ts`: WGS84→UTM 51N, block-cached GeoTIFF reads, median of centroid + 4 interior points,
   accepted in 2.5–200 m) → **estimate** by type and footprint area with deterministic per-id jitter.
   `min_height` / `building:min_level` supported. Every building records its `height_source`
   (`height` | `levels` | `cnbh` | `estimated`). CNBH underestimates towers (Shanghai Tower ≈ 38 m in the raster),
   which is why OSM tags always win where present.
4. **District** assignment via point-in-polygon on the processed districts.
5. **Tiling** (refine `ADD`, each building stored once):

   | Level   | Cell             | Content                              | geometricError |
   | ------- | ---------------- | ------------------------------------ | -------------- |
   | L0 root | whole extent     | height ≥ 120 m                       | 900            |
   | L1      | 0.06° (~6 km)    | height ≥ 45 m or footprint ≥ 4000 m² | 150            |
   | L2      | 0.012° (~1.2 km) | everything else                      | 0 (leaf)       |

   With `maximumScreenSpaceError = 12` L1 appears within ≈ 60 km and L2 within ≈ 10 km of a tile.

6. **Meshing**: earcut roofs, flat-shaded walls, per-building facade tint in `COLOR_0`, feature IDs and a
   property table → GLB via `scripts/lib/gltf.ts`. Tile `transform` = ENU frame at the tile centre, made
   **relative to the parent's frame**.
7. **Output**: `tileset.json` (3D Tiles 1.1 with schema), `content/*.glb`, `stats.json` (counts, height sources,
   histogram, triangle count, bytes).

Tiles above L0 are written with **KHR_mesh_quantization** (int16 positions at 0.1–0.2 m, int8 normals, uint8
colours, uint16 feature IDs); cells with > 40 000 buildings are split into quadrants. Implausible tags
(height > 650 m, > 130 levels) fall back to estimates.

Current numbers (whole municipality, 2026-09-01): 2 387 184 buildings = 196 041 OSM + 2 191 143 Overture
(21 201 Overture duplicates of OSM dropped), 7 642 tiles (1 L0 / 345 L1 / 7 296 L2), 28.9 M triangles, 1.62 GB,
built in 43 s. Height sources: 2 582 `height`, 9 619 `levels`, 2 374 983 estimated — the Overture East-Asia
footprints carry no heights, so height enrichment (CNBH-10m / 3D-GloBFP) is the top phase-2 item.

## 3b. Roads (`scripts/process-geojson/process-pbf.ts`)

All 258 k highway ways are classified into six LOD classes (motorway/trunk, primary, secondary/tertiary,
local = residential/unclassified/living_street/pedestrian, service/track, path = footway/cycleway/steps).
Motorway+primary go to one city-wide file (39 k features, 9.4 MB); everything else is tiled into 0.06° cells
(`public/geojson/roads/{x}_{y}.geojson`, 373 cells, 47 MB total, `index.json` with bbox + class counts) that
`RoadsLayer` streams within 7 km of the view target and drops when far. `streets-index.json` maps 10 680 street
names (zh + en) to a representative point for search.

## 4. Landmarks (`scripts/build-landmarks`)

Parametric, original models built from public dimensions (heights, footprint orientation from the OSM way via
`scripts/validate-data/footprint-heading.ts`). Each registry entry carries `source`, `license`, position,
heading and an `exclusionRadius` used by the building pipeline. Replace any entry's `model` with a licensed asset
to upgrade it.

## 5. Terrain (`scripts/process-dem`)

Shanghai is 0–5 m above sea level, so the app defaults to the WGS84 ellipsoid. The DEM path is kept for future
use: `download-copernicus.sh` fetches the Copernicus DEM GLO-30 COGs for N30–N31 / E120–E122 from the AWS Open
Data bucket, and the README there documents conversion to quantized-mesh with `ctb-tile` (Docker) into
`public/terrain/shanghai`, enabled by `VITE_TERRAIN=local`.

## 6. Validation (`scripts/validate-data`)

`validate.ts` checks feature counts, that every coordinate lies within the municipality (catches GCJ-02
contamination), tileset integrity (content files present, regions valid, child transforms parent-relative), and
runs the Khronos glTF validator on landmark models. Helper scripts: `inspect-tall.ts`, `lookup-places.ts`,
`footprint-heading.ts`, `validate-glb.ts`.

## Deployment

`public/tiles`, `public/models`, `public/geojson` are static. For production upload them to R2/S3 behind a CDN
(enable CORS + `Content-Encoding` for `.glb`/`.json`) and set `VITE_DATA_BASE_URL`; the app resolves every data
URL through `dataUrl()` in `src/config.ts`.
