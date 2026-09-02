#!/usr/bin/env bash
# CNBH-10m — China building height at 10 m resolution (2020), Wu et al. 2023, CC BY 4.0.
# Zenodo record 7923866; 2°×2° GeoTIFF tiles named CNBH10m_X<lon>Y<lat>.tif (tile centre). Shanghai needs X121Y31 (+X123Y31 for the east tip).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=data/raw/cnbh; mkdir -p "$OUT"
for t in CNBH10m_X121Y31 CNBH10m_X123Y31; do
  if [ -s "$OUT/$t.tif" ]; then echo "cached $t"; continue; fi
  echo "downloading $t …"
  curl -fsSL "https://zenodo.org/records/7923866/files/$t.tif?download=1" -o "$OUT/$t.tif"
  ls -la "$OUT/$t.tif"
done
echo done
