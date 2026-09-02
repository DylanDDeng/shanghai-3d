/**
 * Whole-municipality processing of osmium GeoJSONSeq exports (data/raw/pbf/*.geojsonseq):
 *
 *  highways → public/geojson/roads-major.geojson           motorway/trunk/primary city-wide (far LOD, one file)
 *           → public/geojson/roads/{x}_{y}.geojson         all other classes tiled in 0.06° cells (near LOD)
 *           → public/geojson/roads/index.json              cell list with bbox, class counts, bytes
 *           → public/geojson/streets-index.json            street name → representative point (search)
 *  water    → public/geojson/water.geojson                 rivers/lakes/canals city-wide
 *  parks    → public/geojson/parks.geojson
 *
 * Usage: npx tsx scripts/process-geojson/process-pbf.ts [--only=roads,water,parks]
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import * as turf from '@turf/turf';
import type { Feature, LineString, MultiPolygon, Polygon, Position } from 'geojson';

const RAW = path.resolve('data/raw/pbf');
const OUT = path.resolve('public/geojson');
const CELL = 0.06;
const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);
const want = (k: string) => only.length === 0 || only.includes(k);

/** Road class buckets → LOD distance tiers in RoadsLayer. */
export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'local' | 'service' | 'path';
function classify(h: string): RoadClass | null {
  if (/^(motorway|trunk)(_link)?$/.test(h)) return 'motorway';
  if (/^primary(_link)?$/.test(h)) return 'primary';
  if (/^(secondary|tertiary)(_link)?$/.test(h)) return 'secondary';
  if (/^(residential|unclassified|living_street|pedestrian|road)$/.test(h)) return 'local';
  if (/^(service|track)$/.test(h)) return 'service';
  if (/^(footway|path|cycleway|steps|bridleway|corridor)$/.test(h)) return 'path';
  return null; // construction, proposed, bus_guideway, raceway, platform …
}

async function* lines(file: string): AsyncGenerator<Feature> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.replace(/^\x1e/, '').trim();
    if (t) yield JSON.parse(t) as Feature;
  }
}

async function save(rel: string, data: unknown): Promise<number> {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data);
  await writeFile(file, json);
  return Buffer.byteLength(json);
}

const round5 = (g: LineString): LineString => ({
  type: 'LineString',
  coordinates: g.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
});

async function roads() {
  console.log('roads: streaming highways.geojsonseq …');
  const major: Feature[] = [];
  const cells = new Map<string, Feature[]>();
  const streets = new Map<
    string,
    { lon: number; lat: number; len: number; cls: RoadClass; nameEn?: string }
  >();
  let n = 0;
  let skipped = 0;
  for await (const f of lines(path.join(RAW, 'highways.geojsonseq'))) {
    if (f.geometry.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
    const p = f.properties ?? {};
    const cls = classify(String(p.highway ?? ''));
    if (!cls) {
      skipped++;
      continue;
    }
    n++;
    const simplified = turf.simplify(f as Feature<LineString>, {
      tolerance: cls === 'motorway' || cls === 'primary' ? 0.00004 : 0.00002,
      mutate: false,
    });
    const geom = round5(simplified.geometry);
    const props: Record<string, unknown> = { highway: p.highway, cls, name: p.name ?? null };
    if (p['name:en']) props.nameEn = p['name:en'];
    if (p.ref) props.ref = p.ref;
    if (p.bridge === 'yes' || p.tunnel === 'yes') props.level = p.bridge === 'yes' ? 1 : -1;
    if (p.lanes) props.lanes = Number(p.lanes) || undefined;
    if (p.oneway === 'yes') props.oneway = 1;
    const feat = turf.feature(geom, props);
    if (cls === 'motorway' || cls === 'primary') major.push(feat);
    else {
      // assign to the cell of the line's midpoint (lines crossing cell borders belong to exactly one cell)
      const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
      const key = `${Math.floor(mid[0] / CELL)}_${Math.floor(mid[1] / CELL)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(feat);
    }
    if (p.name && cls !== 'path' && cls !== 'service') {
      const name = String(p.name);
      const len = turf.length(feat, { units: 'meters' });
      const cur = streets.get(name);
      if (!cur || len > cur.len) {
        const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
        streets.set(name, {
          lon: mid[0],
          lat: mid[1],
          len,
          cls,
          nameEn: p['name:en'] ? String(p['name:en']) : undefined,
        });
      }
    }
  }
  console.log(`  ${n} roads kept, ${skipped} skipped (construction/proposed/…)`);
  const majorBytes = await save('roads-major.geojson', turf.featureCollection(major));
  console.log(`  → roads-major.geojson: ${major.length} features, ${(majorBytes / 1e6).toFixed(1)} MB`);

  await rm(path.join(OUT, 'roads'), { recursive: true, force: true });
  const index: Array<{ key: string; bbox: number[]; counts: Record<string, number>; bytes: number }> = [];
  let total = 0;
  for (const [key, feats] of cells) {
    const [x, y] = key.split('_').map(Number);
    const counts: Record<string, number> = {};
    for (const f of feats) counts[String(f.properties?.cls)] = (counts[String(f.properties?.cls)] ?? 0) + 1;
    const bytes = await save(`roads/${key}.geojson`, turf.featureCollection(feats));
    total += bytes;
    index.push({
      key,
      bbox: [
        +(x * CELL).toFixed(4),
        +(y * CELL).toFixed(4),
        +((x + 1) * CELL).toFixed(4),
        +((y + 1) * CELL).toFixed(4),
      ],
      counts,
      bytes,
    });
  }
  await save('roads/index.json', { cell: CELL, cells: index });
  console.log(`  → roads/: ${cells.size} cells, ${(total / 1e6).toFixed(1)} MB total`);

  const streetList = [...streets.entries()]
    .sort((a, b) => b[1].len - a[1].len)
    .map(([name, s]) => ({
      n: name,
      e: s.nameEn,
      c: s.cls,
      p: [+s.lon.toFixed(5), +s.lat.toFixed(5)],
      l: Math.round(s.len),
    }));
  const sb = await save('streets-index.json', streetList);
  console.log(`  → streets-index.json: ${streetList.length} named streets, ${(sb / 1e6).toFixed(2)} MB`);
}

async function polygons(
  name: string,
  outName: string,
  minArea: number,
  tolerance: number,
  props: (p: Record<string, unknown>) => Record<string, unknown>,
) {
  console.log(`${name}: streaming …`);
  const feats: Feature[] = [];
  let dropped = 0;
  for await (const f of lines(path.join(RAW, `${name}.geojsonseq`))) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    const g = f as Feature<Polygon | MultiPolygon>;
    let area: number;
    try {
      area = turf.area(g);
    } catch {
      continue;
    }
    if (area < minArea) {
      dropped++;
      continue;
    }
    const s = turf.simplify(g, { tolerance, highQuality: false, mutate: false });
    const geom = turf.truncate(s, { precision: 6, coordinates: 2, mutate: true }).geometry;
    feats.push(turf.feature(geom, props((f.properties ?? {}) as Record<string, unknown>)));
  }
  const bytes = await save(`${outName}.geojson`, turf.featureCollection(feats));
  console.log(
    `  → ${outName}.geojson: ${feats.length} features (${dropped} tiny dropped), ${(bytes / 1e6).toFixed(2)} MB`,
  );
}

async function main() {
  for (const f of ['highways', 'water', 'parks']) {
    try {
      await stat(path.join(RAW, `${f}.geojsonseq`));
    } catch {
      throw new Error(`${f}.geojsonseq missing — run scripts/download-osm/extract-pbf.sh`);
    }
  }
  if (want('roads')) await roads();
  if (want('water'))
    await polygons('water', 'water', 400, 0.00002, (p) => {
      const kind = String(p.water ?? (p.waterway === 'riverbank' ? 'river' : 'water'));
      return { name: p.name ?? null, kind, river: kind === 'river' || kind === 'canal' };
    });
  if (want('parks')) await polygons('parks', 'parks', 2500, 0.00004, (p) => ({ name: p.name ?? null }));
  console.log('Done.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
