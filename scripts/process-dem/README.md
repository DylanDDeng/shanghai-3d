# Terrain pipeline (Copernicus DEM GLO-30 → Cesium quantized-mesh)

Shanghai is nearly flat (0–5 m), so the app defaults to the WGS84 ellipsoid (`VITE_TERRAIN=ellipsoid`). This
pipeline is kept ready for hillier extensions (Sheshan, Chongming dykes) or for exact building placement.

1. `./scripts/process-dem/download-copernicus.sh` — fetches the 30 m COG tiles for N30–N31 / E120–E122.
2. Mosaic + reproject (GDAL, e.g. via Docker `ghcr.io/osgeo/gdal:ubuntu-small-latest`):
   ```bash
   gdalbuildvrt data/raw/dem/shanghai.vrt data/raw/dem/*.tif
   gdalwarp -t_srs EPSG:4326 -te 120.8 30.6 122.3 31.95 -r bilinear data/raw/dem/shanghai.vrt data/raw/dem/shanghai.tif
   ```
3. Quantized-mesh tiles with Cesium Terrain Builder (`tumgis/ctb-quantized-mesh` Docker image):
   ```bash
   docker run --rm -v "$PWD":/data tumgis/ctb-quantized-mesh \
     ctb-tile -f Mesh -C -N -o /data/public/terrain/shanghai /data/data/raw/dem/shanghai.tif
   docker run --rm -v "$PWD":/data tumgis/ctb-quantized-mesh \
     ctb-tile -f Mesh -C -N -l -o /data/public/terrain/shanghai /data/data/raw/dem/shanghai.tif   # layer.json
   ```
4. Set `VITE_TERRAIN=local`. Building tiles are placed at ellipsoid height 0; with real terrain either enable
   `depthTestAgainstTerrain` and clamp the tileset with a height offset, or bake DEM heights into the pipeline
   (per-tile ground height sample) — both are TODOs tracked in DATA_PIPELINE.md.
