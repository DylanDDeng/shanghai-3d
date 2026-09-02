/**
 * Resolve WGS84 coordinates of named places from OpenStreetMap (avoids GCJ-02 contaminated sources).
 * Usage: npx tsx scripts/validate-data/lookup-places.ts  → prints JSON {name: {lon, lat, tags}}
 */
import { overpass } from '../lib/overpass.js';

const NAMES = [
  '上海中心大厦',
  '东方明珠广播电视塔',
  '金茂大厦',
  '上海环球金融中心',
  '上海国际金融中心',
  '上海展览中心',
  '陆家嘴',
  '外滩',
  '南京东路',
  '静安寺',
  '徐家汇',
  '人民广场',
  '豫园',
  '北外滩',
  '上海虹桥国际机场',
  '上海浦东国际机场',
  '和平饭店',
  '上海海关大楼',
];
const BBOX = '30.65,120.85,31.90,122.25';

async function main() {
  const q = `[out:json][timeout:120];(${NAMES.map((n) => `nwr["name"="${n}"](${BBOX});`).join('')});out center tags;`;
  const res = await overpass(q);
  const out: Record<string, unknown[]> = {};
  for (const e of res.elements as Array<{
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags: Record<string, string>;
  }>) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const t = e.tags;
    if (
      t.highway === 'bus_stop' ||
      t.public_transport ||
      t.railway === 'stop' ||
      t.amenity === 'parking' ||
      t.amenity === 'police' ||
      t.railway === 'station' ||
      t.highway === 'residential'
    )
      continue;
    const kind = t.building
      ? `building=${t.building}`
      : t.place
        ? `place=${t.place}`
        : t.railway
          ? `railway=${t.railway}`
          : t.aeroway
            ? `aeroway=${t.aeroway}`
            : t.highway
              ? `highway=${t.highway}`
              : t.tourism
                ? `tourism=${t.tourism}`
                : t.amenity
                  ? `amenity=${t.amenity}`
                  : Object.keys(t)
                      .filter((k) => !k.startsWith('name'))
                      .slice(0, 2)
                      .join(',');
    (out[t.name] ??= []).push({
      osm: `${e.type}/${e.id}`,
      lon: +lon.toFixed(5),
      lat: +lat.toFixed(5),
      kind,
      height: t.height,
      nameEn: t['name:en'],
    });
  }
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
