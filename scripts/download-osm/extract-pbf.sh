#!/usr/bin/env bash
# Whole-municipality extraction from the Geofabrik China PBF with osmium-tool.
#   1. clip to the Shanghai bbox (incl. Chongming + maritime margin)
#   2. tag-filter thematic subsets
#   3. export each subset to GeoJSONSeq (one feature per line, id = "w123"/"r123") for the Node pipelines
# Requires: osmium-tool (brew install osmium-tool). Input: data/raw/pbf/china-latest.osm.pbf
# License: OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0.
set -euo pipefail
cd "$(dirname "$0")/../.."
IN=data/raw/pbf/china-latest.osm.pbf
OUT=data/raw/pbf
BBOX="120.85,30.65,122.25,31.90"
[ -f "$IN" ] || { echo "missing $IN — download from https://download.geofabrik.de/asia/china-latest.osm.pbf"; exit 1; }

if [ ! -f "$OUT/shanghai.osm.pbf" ]; then
  echo "extracting bbox $BBOX …"
  osmium extract -b "$BBOX" -s complete_ways --overwrite -o "$OUT/shanghai.osm.pbf" "$IN"
fi
osmium fileinfo -e "$OUT/shanghai.osm.pbf" | grep -E "Number of (nodes|ways|relations)"

export_seq() { # name, tags-filter expressions..., geometry types
  local name=$1; shift
  local geom=$1; shift
  if [ -f "$OUT/$name.geojsonseq" ]; then echo "cached $name"; return; fi
  echo "filtering $name …"
  osmium tags-filter --overwrite -o "$OUT/$name.osm.pbf" "$OUT/shanghai.osm.pbf" "$@"
  echo "exporting $name …"
  osmium export --overwrite -f geojsonseq --geometry-types="$geom" --add-unique-id=type_id \
    -o "$OUT/$name.geojsonseq" "$OUT/$name.osm.pbf"
  echo "  $(wc -l < "$OUT/$name.geojsonseq") features → $name.geojsonseq ($(du -h "$OUT/$name.geojsonseq" | cut -f1))"
}

export_seq buildings polygon  w/building w/building:part r/building r/building:part
export_seq highways  linestring w/highway
export_seq water     polygon  w/natural=water r/natural=water w/waterway=riverbank r/waterway=riverbank
export_seq parks     polygon  w/leisure=park r/leisure=park w/leisure=garden r/leisure=garden
echo "done"
