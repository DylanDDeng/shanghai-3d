#!/usr/bin/env bash
# Downloads Overture Maps building footprints for the Shanghai bbox straight from the public S3 release with DuckDB.
# Overture buildings theme license: ODbL 1.0 (contains OSM + Microsoft/Google ML footprints; each feature carries
# its `sources` dataset). Output: data/raw/overture/buildings.geojsonseq (one feature per line).
# Requires: duckdb CLI (brew install duckdb). Release: override with OVERTURE_RELEASE=YYYY-MM-DD.0
set -euo pipefail
cd "$(dirname "$0")/../.."
REL="${OVERTURE_RELEASE:-2026-08-19.0}"
OUT=data/raw/overture/buildings.geojsonseq
mkdir -p data/raw/overture
if [ -s "$OUT" ]; then echo "cached $OUT"; exit 0; fi
echo "querying Overture $REL buildings for Shanghai bbox …"
duckdb -c "
INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;
SET s3_region='us-west-2';
COPY (
  SELECT id,
         height, num_floors, min_height, class, subtype,
         names.primary AS name,
         sources[1].dataset AS source,
         geometry
  FROM read_parquet('s3://overturemaps-us-west-2/release/${REL}/theme=buildings/type=building/*', filename=true, hive_partitioning=1)
  WHERE bbox.xmin >= 120.85 AND bbox.xmax <= 122.25 AND bbox.ymin >= 30.65 AND bbox.ymax <= 31.90
) TO '${OUT}' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
"
echo "  $(wc -l < "$OUT") features → $OUT ($(du -h "$OUT" | cut -f1))"
