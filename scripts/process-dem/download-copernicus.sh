#!/usr/bin/env bash
# Downloads Copernicus DEM GLO-30 tiles covering Shanghai from the AWS Open Data bucket (no credentials needed).
# License: Copernicus DEM — free use with attribution "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018
# provided under COPERNICUS by the European Union and ESA; all rights reserved".
# Output: data/raw/dem/*.tif  → then see README.md in this folder for the quantized-mesh conversion.
set -euo pipefail
OUT=data/raw/dem
mkdir -p "$OUT"
for lat in N30 N31; do
  for lon in E120 E121 E122; do
    name="Copernicus_DSM_COG_10_${lat}_00_${lon}_00_DEM"
    url="https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif"
    if [ -f "$OUT/${name}.tif" ]; then echo "cached ${name}"; continue; fi
    echo "fetching ${name}"
    curl -fsSL "$url" -o "$OUT/${name}.tif" || echo "  (missing tile ${name} — probably sea)"
  done
done
echo "done → $OUT"
