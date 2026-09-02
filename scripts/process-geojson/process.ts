/**
 * Convert raw Overpass JSON (data/raw) into the lean GeoJSON files the app loads from public/geojson.
 *
 * Usage: npx tsx scripts/process-geojson/process.ts
 *
 * - boundary / districts: OSM admin relations → (Multi)Polygons with id/name/nameEn
 * - water: Huangpu + inner water bodies → Polygons (tiny ponds dropped; coordinates rounded)
 * - roads: motorway/trunk/primary (city-wide) and secondary/tertiary (inner) → LineStrings
 * - metro: subway route relations (merged per line ref, with colour) + stations (with line refs)
 * - parks: leisure=park polygons
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';
import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';

const RAW = path.resolve('data/raw');
const OUT = path.resolve('public/geojson');

const DISTRICT_EN: Record<string, string> = {
  浦东新区: 'Pudong',
  黄浦区: 'Huangpu',
  徐汇区: 'Xuhui',
  静安区: "Jing'an",
  长宁区: 'Changning',
  杨浦区: 'Yangpu',
  虹口区: 'Hongkou',
  普陀区: 'Putuo',
  闵行区: 'Minhang',
  宝山区: 'Baoshan',
  嘉定区: 'Jiading',
  松江区: 'Songjiang',
  青浦区: 'Qingpu',
  奉贤区: 'Fengxian',
  金山区: 'Jinshan',
  崇明区: 'Chongming',
};
const SH_BBOX = { west: 120.85, south: 30.65, east: 122.25, north: 31.9 };
/** Curated WGS84 view centres for districts whose polygon includes large sea areas (centroid would be offshore). */
const DISTRICT_CENTER: Record<string, [number, number]> = {
  pudong: [121.58, 31.19],
  chongming: [121.45, 31.62],
};
const DISTRICT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(DISTRICT_EN).map(([zh, en]) => [zh, en.toLowerCase().replace(/[^a-z]/g, '')]),
);

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadRaw(name: string): Promise<FeatureCollection | null> {
  const file = path.join(RAW, `${name}.osm.json`);
  if (!(await exists(file))) {
    console.warn(`  (skip) ${name}: not downloaded`);
    return null;
  }
  const json = JSON.parse(await readFile(file, 'utf8'));
  return osmtogeojson(json, { flatProperties: true }) as FeatureCollection;
}

function round(geom: Geometry, decimals = 6): Geometry {
  return turf.truncate(turf.feature(geom), { precision: decimals, coordinates: 2, mutate: true }).geometry;
}

async function save(name: string, fc: FeatureCollection) {
  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.geojson`);
  await writeFile(file, JSON.stringify(fc));
  const s = await stat(file);
  console.log(`  → ${name}.geojson: ${fc.features.length} features, ${(s.size / 1e6).toFixed(2)} MB`);
}

function onlyPolygons(fc: FeatureCollection): Feature<Polygon | MultiPolygon>[] {
  return fc.features.filter(
    (f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon',
  ) as Feature<Polygon | MultiPolygon>[];
}

/** Simplify + drop degenerate polygons; returns null when the polygon is too small. */
function cleanPolygon(
  f: Feature<Polygon | MultiPolygon>,
  tolerance: number,
  minAreaM2: number,
): Feature<Polygon | MultiPolygon> | null {
  try {
    const area = turf.area(f);
    if (area < minAreaM2) return null;
    const simplified = tolerance > 0 ? turf.simplify(f, { tolerance, highQuality: false, mutate: false }) : f;
    if (!simplified.geometry || turf.area(simplified) < minAreaM2 * 0.5) return f;
    return simplified as Feature<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

async function boundary() {
  const fc = await loadRaw('shanghai-boundary');
  if (!fc) return;
  // Shanghai administers exclave farms in Jiangsu/Anhui (大丰、川东、海丰、白茅岭、军天湖); they are legitimate
  // territory but would confuse the city view, so only rings intersecting the contiguous municipality are kept.
  const polys = onlyPolygons(fc)
    .map((f) => {
      const parts = (
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      ).filter((rings) => {
        const [w, s, e, n] = turf.bbox(turf.polygon(rings));
        return e > SH_BBOX.west && w < SH_BBOX.east && n > SH_BBOX.south && s < SH_BBOX.north;
      });
      if (!parts.length) return null;
      const geom: Polygon | MultiPolygon =
        parts.length === 1
          ? { type: 'Polygon', coordinates: parts[0] }
          : { type: 'MultiPolygon', coordinates: parts };
      return cleanPolygon(turf.feature(geom) as Feature<Polygon | MultiPolygon>, 0.0004, 1e6);
    })
    .filter(Boolean) as Feature[];
  await save(
    'shanghai-boundary',
    turf.featureCollection(
      polys.map((f) => turf.feature(round(f.geometry, 5), { name: '上海市', nameEn: 'Shanghai' })),
    ),
  );
}

async function districts() {
  const fc = await loadRaw('districts');
  if (!fc) return;
  const feats: Feature[] = [];
  for (const f of onlyPolygons(fc)) {
    const name = String(f.properties?.name ?? '');
    if (!DISTRICT_EN[name]) continue;
    // osmtogeojson may stitch member ways of unrelated same-named relations (e.g. 宝山区 in Jiangsu) into the
    // multipolygon; keep only rings whose bbox intersects the Shanghai municipality bbox.
    const parts = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).filter(
      (rings) => {
        const [w, s, e, n] = turf.bbox(turf.polygon(rings));
        return e > SH_BBOX.west && w < SH_BBOX.east && n > SH_BBOX.south && s < SH_BBOX.north;
      },
    );
    if (!parts.length) continue;
    const geom: Polygon | MultiPolygon =
      parts.length === 1
        ? { type: 'Polygon', coordinates: parts[0] }
        : { type: 'MultiPolygon', coordinates: parts };
    const c = cleanPolygon(turf.feature(geom) as Feature<Polygon | MultiPolygon>, 0.0003, 1e6);
    if (!c) continue;
    const id = DISTRICT_ID[name];
    // View center: centre of mass when it falls inside the polygon, else a point on the feature; coastal
    // districts whose polygons include sea area get curated urban centres.
    const com = turf.centerOfMass(c).geometry.coordinates;
    const center =
      DISTRICT_CENTER[id] ??
      (turf.booleanPointInPolygon(com, c) ? com : turf.pointOnFeature(c).geometry.coordinates);
    feats.push(
      turf.feature(round(c.geometry, 5), {
        id,
        name,
        nameEn: DISTRICT_EN[name],
        center: center.map((v) => +v.toFixed(4)),
        areaKm2: Math.round(turf.area(c) / 1e6),
      }),
    );
  }
  feats.sort((a, b) => String(a.properties?.id).localeCompare(String(b.properties?.id)));
  await save('districts', turf.featureCollection(feats));
}

async function water() {
  const sources = ['water-huangpu', 'water-rivers', 'water-inner'];
  const seen = new Set<string>();
  const feats: Feature[] = [];
  for (const src of sources) {
    const fc = await loadRaw(src);
    if (!fc) continue;
    for (const f of onlyPolygons(fc)) {
      const id = String(f.id ?? f.properties?.id ?? '');
      if (seen.has(id)) continue;
      seen.add(id);
      const kind = String(f.properties?.water ?? 'water');
      const isRiver =
        kind === 'river' || kind === 'canal' || /黄浦江|苏州河/.test(String(f.properties?.name ?? ''));
      const c = cleanPolygon(f, isRiver ? 0.00002 : 0.00004, isRiver ? 200 : 2500);
      if (!c) continue;
      feats.push(
        turf.feature(round(c.geometry, 6), { name: f.properties?.name ?? null, kind, river: isRiver }),
      );
    }
  }
  await save('water', turf.featureCollection(feats));
}

async function roads() {
  const major = await loadRaw('roads-major');
  if (major) {
    const feats: Feature[] = [];
    for (const f of major.features) {
      if (f.geometry.type !== 'LineString') continue;
      const [w, s0, e, n] = turf.bbox(f);
      if (e < SH_BBOX.west || w > SH_BBOX.east || n < SH_BBOX.south || s0 > SH_BBOX.north) continue; // exclave roads
      const s = turf.simplify(f as Feature<LineString>, { tolerance: 0.00004, mutate: false });
      feats.push(
        turf.feature(round(s.geometry, 5), {
          highway: f.properties?.highway,
          name: f.properties?.name ?? null,
          ref: f.properties?.ref ?? null,
        }),
      );
    }
    await save('roads-major', turf.featureCollection(feats));
  }
  const inner = await loadRaw('roads-inner');
  if (inner) {
    const feats: Feature[] = [];
    for (const f of inner.features) {
      if (f.geometry.type !== 'LineString') continue;
      const s = turf.simplify(f as Feature<LineString>, { tolerance: 0.00003, mutate: false });
      feats.push(
        turf.feature(round(s.geometry, 5), {
          highway: f.properties?.highway,
          name: f.properties?.name ?? null,
        }),
      );
    }
    await save('roads-inner', turf.featureCollection(feats));
  }
}

async function metro() {
  const linesRaw = await loadRaw('metro-lines');
  const stationsRaw = await loadRaw('metro-stations');
  const stationLines = new Map<string, Set<string>>(); // station name → line refs
  if (linesRaw) {
    // osmtogeojson turns each route relation into a MultiLineString feature; merge per line ref.
    const byRef = new Map<string, { colour: string; name: string; lines: Position[][] }>();
    for (const f of linesRaw.features) {
      const p = f.properties ?? {};
      const ref =
        String(p.ref ?? p.name ?? '')
          .replace(/号线|地铁|上海|轨道交通|Line\s*/gi, '')
          .trim() || String(p.name);
      if (f.geometry.type !== 'MultiLineString' && f.geometry.type !== 'LineString') continue;
      const entry = byRef.get(ref) ?? {
        colour: String(p.colour ?? '#ffffff'),
        name: String(p.name ?? ref),
        lines: [],
      };
      const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of coords) entry.lines.push(line);
      byRef.set(ref, entry);
    }
    const feats: Feature[] = [];
    for (const [ref, e] of [...byRef.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], 'zh', { numeric: true }),
    )) {
      const ml = turf.multiLineString(e.lines, { ref, name: e.name, colour: e.colour });
      const s = turf.simplify(ml, { tolerance: 0.00005, mutate: false });
      feats.push(turf.feature(round(s.geometry, 5), s.properties));
    }
    await save('metro-lines', turf.featureCollection(feats));
    // Station → lines mapping via relation members is lost in osmtogeojson; approximate spatially.
    if (stationsRaw) {
      for (const f of feats) {
        const ref = String(f.properties?.ref);
        for (const s of stationsRaw.features) {
          if (s.geometry.type !== 'Point') continue;
          const name = String(s.properties?.name ?? '');
          const coords =
            f.geometry.type === 'LineString'
              ? [f.geometry.coordinates]
              : f.geometry.type === 'MultiLineString'
                ? f.geometry.coordinates
                : [];
          let d = Infinity;
          for (const line of coords) {
            if (line.length < 2) continue;
            d = Math.min(
              d,
              turf.pointToLineDistance(s.geometry.coordinates, turf.lineString(line), { units: 'meters' }),
            );
            if (d < 60) break;
          }
          if (d < 60) {
            const set = stationLines.get(name) ?? new Set<string>();
            set.add(ref);
            stationLines.set(name, set);
          }
        }
      }
    }
  }
  if (stationsRaw) {
    const byName = new Map<string, Feature>();
    for (const s of stationsRaw.features) {
      if (s.geometry.type !== 'Point') continue;
      const name = String(s.properties?.name ?? '');
      if (!name || byName.has(name)) continue;
      const lines = [...(stationLines.get(name) ?? [])].sort((a, b) =>
        a.localeCompare(b, 'zh', { numeric: true }),
      );
      byName.set(
        name,
        turf.point(
          s.geometry.coordinates.map((c) => Number(c.toFixed(6))),
          { name, nameEn: s.properties?.['name:en'] ?? null, lines },
        ),
      );
    }
    await save('metro-stations', turf.featureCollection([...byName.values()]));
  }
}

async function parks() {
  const fc = await loadRaw('parks-inner');
  if (!fc) return;
  const feats: Feature[] = [];
  for (const f of onlyPolygons(fc)) {
    const c = cleanPolygon(f, 0.00004, 3000);
    if (!c) continue;
    feats.push(turf.feature(round(c.geometry, 6), { name: f.properties?.name ?? null }));
  }
  await save('parks', turf.featureCollection(feats));
}

async function main() {
  console.log('Processing raw OSM → public/geojson');
  await boundary();
  await districts();
  await water();
  await roads();
  await metro();
  await parks();
  console.log('Done.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
