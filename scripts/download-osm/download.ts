/**
 * Download raw OpenStreetMap data for Shanghai via Overpass API.
 *
 * Usage:  npx tsx scripts/download-osm/download.ts [--only=boundary,districts,water,roads,metro,buildings,parks]
 *
 * Output: data/raw/*.osm.json  (raw Overpass JSON; gitignored)
 *
 * Buildings are fetched as a grid of bbox queries (Overpass cannot return the
 * whole city in one request). Adjust BUILDING_EXTENT / BUILDING_STEP to extend coverage.
 *
 * License: OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0.
 */
import { cachedOverpass as rawCachedOverpass } from '../lib/overpass.js';

const failures: string[] = [];
/** Non-fatal wrapper: a failed query is logged and the script continues with the next dataset. */
async function cachedOverpass(name: string, query: string) {
  try {
    return await rawCachedOverpass(name, query);
  } catch (e) {
    console.error(`  [FAILED] ${name}: ${(e as Error).message.slice(0, 120)}`);
    failures.push(name);
    return null;
  }
}

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);
const want = (k: string) => only.length === 0 || only.includes(k);

/** Whole Shanghai municipality bbox (incl. Chongming). [south, west, north, east] */
const SHANGHAI_BBOX = '30.65,120.85,31.90,122.25';

/** Inner Shanghai (dense building extraction extent) [west, south, east, north] */
export const BUILDING_EXTENT = { west: 121.32, south: 31.1, east: 121.68, north: 31.36 };
const BUILDING_STEP = 0.06; // ~5.7 km x 6.6 km per query

const SHANGHAI_AREA = `rel["boundary"="administrative"]["admin_level"="4"]["name"="上海市"];map_to_area->.sh;`;

async function main() {
  console.log('Downloading OSM data for Shanghai…');

  if (want('boundary')) {
    await cachedOverpass(
      'shanghai-boundary',
      `[out:json][timeout:120];rel["boundary"="administrative"]["admin_level"="4"]["name"="上海市"];out geom;`,
    );
  }

  if (want('districts')) {
    await cachedOverpass(
      'districts',
      `[out:json][timeout:180];${SHANGHAI_AREA}rel(area.sh)["boundary"="administrative"]["admin_level"="6"];out geom;`,
    );
  }

  if (want('water')) {
    // Huangpu river + Suzhou creek by name (they are big multipolygon relations), plus all water in inner Shanghai.
    await cachedOverpass(
      'water-huangpu',
      `[out:json][timeout:180];(rel["natural"="water"]["name"~"黄浦江|苏州河"](${SHANGHAI_BBOX});way["natural"="water"]["name"~"黄浦江|苏州河"](${SHANGHAI_BBOX});rel["waterway"="riverbank"]["name"~"黄浦江"](${SHANGHAI_BBOX}););out geom;`,
    );
    const { west, south, east, north } = BUILDING_EXTENT;
    await cachedOverpass(
      'water-inner',
      `[out:json][timeout:180];(way["natural"="water"](${south},${west},${north},${east});rel["natural"="water"](${south},${west},${north},${east}););out geom;`,
    );
    // Full Huangpu River corridor (Dianshan Lake outlet -> Wusongkou) + Suzhou Creek for the far LOD.
    await cachedOverpass(
      'water-rivers',
      `[out:json][timeout:300];(way["natural"="water"]["water"="river"](30.95,121.2,31.45,121.85);rel["natural"="water"]["water"="river"](30.95,121.2,31.45,121.85););out geom;`,
    );
  }

  if (want('roads')) {
    // City-wide major roads (for the far LOD)
    await cachedOverpass(
      'roads-major',
      `[out:json][timeout:300];${SHANGHAI_AREA}way(area.sh)["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary)$"];out geom;`,
    );
    // Inner Shanghai secondary/tertiary (for the near LOD)
    const { west, south, east, north } = BUILDING_EXTENT;
    await cachedOverpass(
      'roads-inner',
      `[out:json][timeout:300];way["highway"~"^(secondary|secondary_link|tertiary|tertiary_link)$"](${south},${west},${north},${east});out geom;`,
    );
  }

  if (want('metro')) {
    await cachedOverpass(
      'metro-lines',
      `[out:json][timeout:300];${SHANGHAI_AREA}rel(area.sh)["route"="subway"];out geom;`,
    );
    await cachedOverpass(
      'metro-stations',
      `[out:json][timeout:180];${SHANGHAI_AREA}(node(area.sh)["railway"="station"]["station"="subway"];node(area.sh)["railway"="station"]["subway"="yes"];);out;`,
    );
  }

  if (want('parks')) {
    const { west, south, east, north } = BUILDING_EXTENT;
    await cachedOverpass(
      'parks-inner',
      `[out:json][timeout:180];(way["leisure"="park"](${south},${west},${north},${east});rel["leisure"="park"](${south},${west},${north},${east}););out geom;`,
    );
  }

  if (want('buildings')) {
    const { west, south, east, north } = BUILDING_EXTENT;
    let i = 0;
    for (let y = south; y < north - 1e-9; y += BUILDING_STEP) {
      for (let x = west; x < east - 1e-9; x += BUILDING_STEP) {
        const s = y.toFixed(3),
          w = x.toFixed(3);
        const n = Math.min(north, y + BUILDING_STEP).toFixed(3);
        const e = Math.min(east, x + BUILDING_STEP).toFixed(3);
        const name = `buildings-${w}_${s}`;
        i++;
        await cachedOverpass(
          name,
          `[out:json][timeout:300][maxsize:536870912];(way["building"](${s},${w},${n},${e});way["building:part"](${s},${w},${n},${e});rel["building"](${s},${w},${n},${e});rel["building:part"](${s},${w},${n},${e}););out geom;`,
        );
      }
    }
    console.log(`  buildings: ${i} grid cells`);
  }
  if (failures.length) {
    console.error(
      `Done with ${failures.length} failed dataset(s): ${failures.join(', ')} — re-run to retry.`,
    );
    process.exit(2);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
