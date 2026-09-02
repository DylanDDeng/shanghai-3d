/**
 * Shanghai building pipeline: OSM footprints → cleaned polygons → heights → extruded meshes → 3D Tiles 1.1.
 *
 * Usage:
 *   npx tsx scripts/process-buildings/build-shanghai-buildings.ts [--input=data/raw] [--out=public/tiles/buildings]
 *
 * Input:  data/raw/buildings-*.osm.json (Overpass JSON from scripts/download-osm) — any number of grid cells.
 *         Also accepts *.geojson FeatureCollections in the input dir (e.g. from Overture or a PBF export).
 * Output: <out>/tileset.json + content/*.glb + stats.json
 *
 * Tiling / LOD (refine: ADD, so each building is stored exactly once):
 *   L0  root          — buildings ≥ 120 m (skyline), whole extent
 *   L1  0.06° cells   — buildings ≥ 45 m or footprint ≥ 4000 m²   (loads around ~10–60 km)
 *   L2  0.012° cells  — everything else                            (loads within ~5–10 km)
 * Heights: OSM `height` → `building:levels` × per-type floor height → typed/area-based estimate with
 * deterministic jitter (no two neighbouring estimates identical). `min_height` / `building:min_level` supported.
 */
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { buildGlb, type PropertyTable } from '../lib/gltf.js';
import { HeightRasterSet } from '../lib/raster.js';
import {
  MeshBuilder,
  LocalProjector,
  enuToFixedFrame,
  mat4Multiply,
  mat4InvertRigid,
  MAT4_IDENTITY,
  type V2,
  type V3,
} from '../lib/geometry.js';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('=')),
);
const INPUT = path.resolve(args.input ?? 'data/raw');
const OUT = path.resolve(args.out ?? 'public/tiles/buildings');
const LANDMARKS = path.resolve('public/models/landmarks/landmarks.json');

const L1_CELL = 0.06;
const L2_CELL = 0.012;
const L0_MIN_HEIGHT = 120;
const L1_MIN_HEIGHT = 45;
const L1_MIN_AREA = 4000;
const GEOMETRIC_ERROR = { root: 900, l1: 150, l2: 0 };
/** Max features per tile (UINT16 feature IDs + sane request sizes); denser cells are split into quadrants. */
const MAX_PER_TILE = 40_000;
const QUANTIZE = !args['no-quantize'];

// ---------------------------------------------------------------------------------------- types

interface Building {
  id: number;
  rings: Position[][]; // outer + holes, lon/lat
  height: number;
  minHeight: number;
  levels?: number;
  heightSource: 'height' | 'levels' | 'cnbh' | 'estimated';
  type: string;
  name?: string;
  area: number;
  centroid: [number, number];
  district?: string;
  /** osm | overture:<dataset> (e.g. overture:Microsoft ML Buildings) */
  source: string;
}

interface Stats {
  input: number;
  deduplicated: number;
  droppedInvalid: number;
  droppedTiny: number;
  droppedOutlinesWithParts: number;
  droppedLandmarks: number;
  overtureInput: number;
  overtureAdded: number;
  overtureDuplicates: number;
  output: number;
  sources: Record<string, number>;
  heightSources: Record<string, number>;
  heightHistogram: Record<string, number>;
  tiles: { L0: number; L1: number; L2: number };
  totalTriangles: number;
  totalBytes: number;
  maxHeight: number;
  extent: { west: number; south: number; east: number; north: number };
}

// ---------------------------------------------------------------------------------------- helpers

function hash(n: number): number {
  // deterministic 0..1 from an integer (xorshift-ish)
  let x = (n ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return (x % 100000) / 100000;
}

/** Deterministic 31-bit id from a string (Overture GERS ids are UUID-like). */
function stableHashId(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h & 0x3fffffff) + 1_000_000_000; // above any OSM way id range we care about, positive
}

function parseLength(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(',', '.');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|meters?|ft|feet|')?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit.startsWith('f') || unit === "'" ? n * 0.3048 : n;
}

function parseLevels(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const RESIDENTIAL = /^(residential|apartments|house|detached|semidetached_house|terrace|dormitory|bungalow)$/;
const COMMERCIAL = /^(commercial|office|retail|hotel|supermarket|mall|bank)$/;
const INDUSTRIAL =
  /^(industrial|warehouse|factory|manufacture|hangar|storage_tank|greenhouse|barn|shed|garage|garages|carport|parking)$/;
const CIVIC =
  /^(school|university|college|hospital|public|civic|government|train_station|transportation|church|temple|religious|kindergarten|stadium|sports_centre)$/;

function floorHeight(type: string): number {
  if (RESIDENTIAL.test(type)) return 3.0;
  if (COMMERCIAL.test(type)) return 3.9;
  if (INDUSTRIAL.test(type)) return 5.0;
  if (CIVIC.test(type)) return 3.8;
  return 3.2;
}

/** Height estimate when neither `height` nor `building:levels` are present. */
function estimateHeight(type: string, area: number, id: number): number {
  const r = hash(id);
  const r2 = hash(id * 7 + 13);
  let floors: number;
  if (RESIDENTIAL.test(type)) {
    if (area < 120)
      floors = 2 + Math.round(r * 1); // houses
    else if (area < 400)
      floors = 5 + Math.round(r * 2); // lilong / walk-ups
    else if (area < 1200)
      floors = 6 + Math.round(r * 12); // slab apartments 6–18
    else floors = 11 + Math.round(r * 20); // towers 11–31
  } else if (COMMERCIAL.test(type)) {
    if (area < 300) floors = 2 + Math.round(r * 3);
    else if (area < 1500) floors = 4 + Math.round(r * 10);
    else floors = 8 + Math.round(r * 22);
  } else if (INDUSTRIAL.test(type)) {
    return 6 + r * 8;
  } else if (CIVIC.test(type)) {
    floors = 3 + Math.round(r * 4);
  } else {
    // building=yes: infer from footprint size
    if (area < 60) return 3 + r * 2;
    if (area < 200) floors = 2 + Math.round(r * 3);
    else if (area < 600) floors = 4 + Math.round(r * 5);
    else if (area < 2000) floors = 6 + Math.round(r * 10);
    else floors = 8 + Math.round(r * 16);
  }
  const fh = floorHeight(type) * (0.95 + r2 * 0.1);
  return floors * fh;
}

function polygonRings(geom: Polygon | MultiPolygon): Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

/** Clean a ring: drop duplicate consecutive points, un-close, require ≥3 points. */
function cleanRing(ring: Position[]): Position[] | null {
  const out: Position[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const f = out[0],
      l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  }
  return out.length >= 3 ? out : null;
}

// ---------------------------------------------------------------------------------------- load

async function loadFeatures(): Promise<{
  features: Feature<Polygon | MultiPolygon>[];
  parts: Feature<Polygon | MultiPolygon>[];
}> {
  const all = (await readdir(INPUT, { recursive: true })) as string[];
  const files = all.filter((f) => /(^|\/)buildings[^/]*\.(osm\.json|geojson|geojsonseq)$/.test(f));
  if (!files.length)
    throw new Error(
      `No buildings*.{osm.json,geojson,geojsonseq} in ${INPUT}. Run scripts/download-osm first.`,
    );
  const seen = new Set<string>();
  const features: Feature<Polygon | MultiPolygon>[] = [];
  const parts: Feature<Polygon | MultiPolygon>[] = [];
  const take = (f: Feature) => {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return false;
    const key = String(f.id ?? f.properties?.id ?? JSON.stringify(f.geometry.coordinates[0]?.[0]));
    if (seen.has(key)) return false;
    seen.add(key);
    const p = f.properties ?? {};
    if (p['building:part'] && p['building:part'] !== 'no' && !p.building)
      parts.push(f as Feature<Polygon | MultiPolygon>);
    else if (p.building && p.building !== 'no') features.push(f as Feature<Polygon | MultiPolygon>);
    else return false;
    return true;
  };
  for (const file of files.sort()) {
    const full = path.join(INPUT, file);
    let n = 0;
    if (file.endsWith('.geojsonseq')) {
      // osmium export: one feature per line (optionally RS-prefixed). Streamed so a whole municipality fits in memory.
      const rl = createInterface({ input: createReadStream(full), crlfDelay: Infinity });
      for await (const line of rl) {
        const t = line.replace(/^\x1e/, '').trim();
        if (!t) continue;
        const f = JSON.parse(t) as Feature;
        if (f.properties && !f.properties.id && f.id === undefined)
          f.properties.id = (f as { properties: { id?: string } }).properties.id;
        if (take(f)) n++;
      }
    } else {
      const raw = JSON.parse(await readFile(full, 'utf8'));
      const fc: FeatureCollection = file.endsWith('.geojson')
        ? raw
        : (osmtogeojson(raw, { flatProperties: true }) as FeatureCollection);
      for (const f of fc.features) if (take(f)) n++;
    }
    console.log(`  ${file}: ${n} polygons`);
  }
  return { features, parts };
}

/**
 * Overture Maps buildings (data/raw/overture/buildings.geojsonseq, from scripts/download-osm/download-overture.sh).
 * Only features NOT sourced from OpenStreetMap are candidates: OSM-sourced ones are already in the OSM input.
 */
async function loadOverture(): Promise<Feature<Polygon | MultiPolygon>[]> {
  const file = path.resolve('data/raw/overture/buildings.geojsonseq');
  try {
    await stat(file);
  } catch {
    return [];
  }
  const out: Feature<Polygon | MultiPolygon>[] = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let osmSourced = 0;
  for await (const line of rl) {
    const t = line.replace(/^\x1e/, '').trim();
    if (!t) continue;
    const f = JSON.parse(t) as Feature;
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    const src = String(f.properties?.source ?? '');
    if (/openstreetmap/i.test(src)) {
      osmSourced++;
      continue;
    }
    out.push(f as Feature<Polygon | MultiPolygon>);
  }
  console.log(`  overture: ${out.length} non-OSM footprints (${osmSourced} OSM-sourced skipped)`);
  return out;
}

/** Simple lon/lat grid index over building bboxes for overlap tests. */
class GridIndex {
  private cells = new Map<string, number[]>();
  constructor(
    private readonly items: Building[],
    private readonly cell = 0.002,
  ) {
    items.forEach((b, i) => {
      const [w, s, e, n] = bboxOf([b], 0);
      for (let x = Math.floor(w / cell); x <= Math.floor(e / cell); x++)
        for (let y = Math.floor(s / cell); y <= Math.floor(n / cell); y++) {
          const k = `${x}_${y}`;
          (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
        }
    });
  }
  /** Buildings whose bbox may intersect the given bbox. */
  query(w: number, s: number, e: number, n: number): Building[] {
    const seen = new Set<number>();
    const out: Building[] = [];
    for (let x = Math.floor(w / this.cell); x <= Math.floor(e / this.cell); x++)
      for (let y = Math.floor(s / this.cell); y <= Math.floor(n / this.cell); y++)
        for (const i of this.cells.get(`${x}_${y}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(this.items[i]);
        }
    return out;
  }
}

/**
 * Merge Overture footprints into the OSM set: a candidate is added only when no OSM building overlaps it
 * (its centroid is inside no OSM footprint, and no OSM centroid lies inside it, and no OSM footprint of similar
 * size shares > 30 % of its bbox). OSM stays authoritative wherever it exists.
 */
function mergeOverture(osm: Building[], overture: Building[], stats: Stats): Building[] {
  const index = new GridIndex(osm);
  const added: Building[] = [];
  for (const cand of overture) {
    const [w, s, e, n] = bboxOf([cand], 0);
    const candPoly = turf.polygon(cand.rings.map((r) => [...r, r[0]]));
    let dup = false;
    for (const b of index.query(w, s, e, n)) {
      const [bw, bs, be, bn] = bboxOf([b], 0);
      if (be < w || bw > e || bn < s || bs > n) continue;
      if (turf.booleanPointInPolygon(b.centroid, candPoly)) {
        dup = true;
        break;
      }
      const bPoly = turf.polygon(b.rings.map((r) => [...r, r[0]]));
      if (turf.booleanPointInPolygon(cand.centroid, bPoly)) {
        dup = true;
        break;
      }
      // bbox overlap ratio as a cheap proxy for partial duplicates
      const iw = Math.min(e, be) - Math.max(w, bw);
      const ih = Math.min(n, bn) - Math.max(s, bs);
      const inter = iw * ih;
      const candArea = (e - w) * (n - s);
      if (inter > 0.3 * candArea) {
        dup = true;
        break;
      }
    }
    if (dup) stats.overtureDuplicates++;
    else added.push(cand);
  }
  stats.overtureAdded = added.length;
  return osm.concat(added);
}

/**
 * CNBH-10m (Wu et al. 2023, CC BY 4.0): 10 m building-height raster for China. Replaces *estimated* heights only —
 * OSM `height` / `building:levels` stay authoritative, because the raster model saturates on towers
 * (Shanghai Tower reads ~38 m). Each building samples its centroid plus up to four interior points and takes the
 * median of the valid (> 0) values.
 */
async function applyCnbhHeights(buildings: Building[], stats: Stats): Promise<void> {
  const dir = path.resolve('data/raw/cnbh');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.tif')).map((f) => path.join(dir, f));
  } catch {
    /* no rasters */
  }
  if (!files.length) {
    console.log(
      '  cnbh: no rasters in data/raw/cnbh (run scripts/download-osm/download-cnbh.sh) — keeping estimates',
    );
    return;
  }
  const set = await HeightRasterSet.open(files);
  console.log(`CNBH-10m heights (${set.size} tiles)…`);
  let replaced = 0;
  let missed = 0;
  let i = 0;
  const t0 = Date.now();
  for (const b of buildings) {
    i++;
    if (b.heightSource !== 'estimated') continue;
    const [w, s, e, n] = bboxOf([b], 0);
    const pts: Array<[number, number]> = [b.centroid];
    if (b.area > 150) {
      const dx = (e - w) * 0.25;
      const dy = (n - s) * 0.25;
      pts.push(
        [b.centroid[0] - dx, b.centroid[1]],
        [b.centroid[0] + dx, b.centroid[1]],
        [b.centroid[0], b.centroid[1] - dy],
        [b.centroid[0], b.centroid[1] + dy],
      );
    }
    const vals: number[] = [];
    for (const [lon, lat] of pts) {
      const v = await set.sample(lon, lat);
      if (v !== null && v >= 2.5 && v <= 200) vals.push(v);
    }
    if (!vals.length) {
      missed++;
      continue;
    }
    vals.sort((a, c) => a - c);
    const median = vals[Math.floor(vals.length / 2)];
    b.height = Math.max(b.minHeight + 2.5, Math.round(median * 10) / 10);
    b.heightSource = 'cnbh';
    b.levels = undefined;
    replaced++;
    if (i % 500000 === 0)
      console.log(`  cnbh: ${i}/${buildings.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  stats.heightSources = {};
  console.log(
    `  cnbh: ${replaced} heights from raster, ${missed} buildings without raster coverage keep estimates`,
  );
}

function osmNumericId(f: Feature): number {
  const raw = String(f.id ?? f.properties?.id ?? '');
  const m = raw.match(/(\d+)$/);
  const n = m ? parseInt(m[1], 10) : 0;
  // osmium `--add-unique-id=type_id` area ids: "a" + (way_id*2) for closed ways, "a" + (rel_id*2+1) for relations.
  if (raw.startsWith('a')) return n % 2 === 0 ? n / 2 : -((n - 1) / 2);
  return raw.startsWith('relation') || raw.startsWith('r') ? -n : n;
}

// ---------------------------------------------------------------------------------------- process

interface LandmarkEntry {
  id: string;
  longitude: number;
  latitude: number;
  exclusionRadius?: number;
  osmIds?: number[];
}

async function loadLandmarks(): Promise<LandmarkEntry[]> {
  try {
    return JSON.parse(await readFile(LANDMARKS, 'utf8')) as LandmarkEntry[];
  } catch {
    return [];
  }
}

async function loadDistricts(): Promise<
  Array<{ name: string; feature: Feature<Polygon | MultiPolygon>; bbox: number[] }>
> {
  try {
    const fc = JSON.parse(
      await readFile(path.resolve('public/geojson/districts.geojson'), 'utf8'),
    ) as FeatureCollection;
    return fc.features.map((f) => ({
      name: String(f.properties?.name),
      feature: f as Feature<Polygon | MultiPolygon>,
      bbox: turf.bbox(f),
    }));
  } catch {
    return [];
  }
}

function toBuildings(
  features: Feature<Polygon | MultiPolygon>[],
  parts: Feature<Polygon | MultiPolygon>[],
  landmarks: LandmarkEntry[],
  districts: Awaited<ReturnType<typeof loadDistricts>>,
  stats: Stats,
  sourceLabel: 'osm' | 'overture' = 'osm',
): Building[] {
  // Index part centroids so outlines that are subdivided into building:parts are not extruded twice.
  const partPoints = parts.map((p) => turf.centroid(p).geometry.coordinates as [number, number]);
  const landmarkIds = new Set(landmarks.flatMap((l) => l.osmIds ?? []));
  const out: Building[] = [];
  const all = [...features.map((f) => ({ f, part: false })), ...parts.map((f) => ({ f, part: true }))];
  stats.input = all.length;

  for (const { f, part } of all) {
    const p = f.properties ?? {};
    const id = sourceLabel === 'osm' ? osmNumericId(f) : stableHashId(String(f.id ?? p.id ?? ''));
    if (sourceLabel === 'osm' && landmarkIds.has(Math.abs(id))) {
      stats.droppedLandmarks++;
      continue;
    }
    for (const polyRings of polygonRings(f.geometry)) {
      const rings: Position[][] = [];
      for (const r of polyRings) {
        const c = cleanRing(r);
        if (c) rings.push(c);
      }
      if (!rings.length) {
        stats.droppedInvalid++;
        continue;
      }
      let poly: Feature<Polygon>;
      try {
        poly = turf.polygon(rings.map((r) => [...r, r[0]]));
      } catch {
        stats.droppedInvalid++;
        continue;
      }
      // Fix self-intersections by splitting; keep the largest piece(s).
      let pieces: Feature<Polygon>[] = [poly];
      try {
        if (turf.kinks(poly).features.length) pieces = turf.unkinkPolygon(poly).features;
      } catch {
        /* keep as-is */
      }
      for (const piece of pieces) {
        const area = turf.area(piece);
        if (area < (sourceLabel === 'overture' ? 15 : 8)) {
          stats.droppedTiny++;
          continue;
        }
        const [cx, cy] = turf.centroid(piece).geometry.coordinates;
        // Outline containing building:parts → skip (parts carry the detail)
        if (!part && partPoints.length) {
          let hasParts = false;
          const bb = turf.bbox(piece);
          for (const pt of partPoints) {
            if (pt[0] < bb[0] || pt[0] > bb[2] || pt[1] < bb[1] || pt[1] > bb[3]) continue;
            if (turf.booleanPointInPolygon(pt, piece)) {
              hasParts = true;
              break;
            }
          }
          if (hasParts) {
            stats.droppedOutlinesWithParts++;
            continue;
          }
        }
        // Landmark exclusion by proximity
        let nearLandmark = false;
        for (const l of landmarks) {
          const d = turf.distance([cx, cy], [l.longitude, l.latitude], { units: 'meters' });
          if (d < (l.exclusionRadius ?? 75)) {
            nearLandmark = true;
            break;
          }
        }
        if (nearLandmark) {
          stats.droppedLandmarks++;
          continue;
        }

        const type = String(p.building ?? p['building:part'] ?? p.class ?? p.subtype ?? 'yes').toLowerCase();
        let levels = parseLevels(p['building:levels'] ?? p.num_floors);
        if (levels !== undefined && levels > 130) levels = undefined; // typo-level tags (e.g. 1000 floors)
        const roofLevels = parseLevels(p['roof:levels']) ?? 0;
        const minLevel = parseLevels(p['building:min_level']);
        let height = parseLength(p.height);
        let source: Building['heightSource'] = 'height';
        const dataSource = sourceLabel === 'osm' ? 'osm' : `overture:${String(p.source ?? 'unknown')}`;
        // Implausible tags (e.g. height=1000 on a shed): only the Shanghai Tower class of buildings exceeds 500 m.
        if (height !== undefined && (height > 650 || (height > 350 && area < 400))) height = undefined;
        if (height === undefined || height <= 0) {
          if (levels !== undefined && levels > 0) {
            height = (levels + roofLevels) * floorHeight(type) * (0.97 + hash(id) * 0.06);
            source = 'levels';
          } else {
            height = estimateHeight(type, area, id);
            source = 'estimated';
          }
        }
        let minHeight =
          parseLength(p.min_height) ?? (minLevel !== undefined ? minLevel * floorHeight(type) : 0);
        if (minHeight >= height) minHeight = 0;
        height = Math.min(Math.max(height, 2.5), 700);

        let district: string | undefined;
        for (const d of districts) {
          if (cx < d.bbox[0] || cx > d.bbox[2] || cy < d.bbox[1] || cy > d.bbox[3]) continue;
          if (turf.booleanPointInPolygon([cx, cy], d.feature)) {
            district = d.name;
            break;
          }
        }
        // Light simplification (≈0.25 m) to shave vertices on curvy footprints.
        const simplified = turf.simplify(piece, { tolerance: 0.0000025, highQuality: false, mutate: false });
        const finalRings = (simplified.geometry.coordinates.length ? simplified : piece).geometry.coordinates
          .map((r) => cleanRing(r))
          .filter(Boolean) as Position[][];
        if (!finalRings.length || finalRings[0].length < 3) {
          stats.droppedInvalid++;
          continue;
        }
        out.push({
          id,
          rings: finalRings,
          height,
          minHeight,
          levels,
          heightSource: source,
          type,
          name: p.name ? String(p.name) : undefined,
          area,
          centroid: [cx, cy],
          district,
          source: dataSource,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------- tiling

interface Tile {
  key: string;
  level: 0 | 1 | 2;
  buildings: Building[];
  bbox: [number, number, number, number]; // w s e n
}

function cellKey(b: Building, cell: number): string {
  const x = Math.floor(b.centroid[0] / cell);
  const y = Math.floor(b.centroid[1] / cell);
  return `${x}_${y}`;
}

/** Split an over-full cell into quadrants (recursively) so no tile exceeds MAX_PER_TILE features. */
function splitCell(key: string, buildings: Building[]): Array<[string, Building[]]> {
  if (buildings.length <= MAX_PER_TILE) return [[key, buildings]];
  const [w, s, e, n] = bboxOf(buildings, 0);
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  const q: Building[][] = [[], [], [], []];
  for (const b of buildings) q[(b.centroid[0] >= mx ? 1 : 0) + (b.centroid[1] >= my ? 2 : 0)].push(b);
  return q.flatMap((bs, i) => (bs.length ? splitCell(`${key}q${i}`, bs) : []));
}

function facadeColor(b: Building): { wall: V3; roof: V3 } {
  const r = hash(b.id * 3 + 1);
  const g = hash(b.id * 5 + 2);
  // Warm/cool light facade tints; taller glass towers lean blue.
  let base: V3;
  if (b.height > 100) base = [0.72 + g * 0.1, 0.8 + g * 0.08, 0.9];
  else if (RESIDENTIAL.test(b.type)) base = [0.86 + r * 0.08, 0.83 + r * 0.06, 0.78 + g * 0.08];
  else if (INDUSTRIAL.test(b.type)) base = [0.75 + r * 0.1, 0.76 + r * 0.1, 0.78 + r * 0.05];
  else base = [0.84 + r * 0.1, 0.85 + r * 0.08, 0.86 + g * 0.06];
  const roof: V3 = [base[0] * 0.9, base[1] * 0.9, base[2] * 0.9];
  return { wall: base, roof };
}

function buildTileGlb(tile: Tile): {
  glb: Buffer;
  center: [number, number];
  minH: number;
  maxH: number;
  triangles: number;
} {
  const [w, s, e, n] = tile.bbox;
  const center: [number, number] = [(w + e) / 2, (s + n) / 2];
  const proj = new LocalProjector(center[0], center[1]);
  const mb = new MeshBuilder({ colors: true, featureIds: true });
  let maxH = 0;
  const props: PropertyTable = {
    className: 'building',
    count: tile.buildings.length,
    properties: {
      id: { type: 'INT32', values: [] },
      name: { type: 'STRING', values: [] },
      height: { type: 'FLOAT32', values: [] },
      min_height: { type: 'FLOAT32', values: [] },
      levels: { type: 'FLOAT32', values: [] },
      building: { type: 'STRING', values: [] },
      district: { type: 'STRING', values: [] },
      height_source: { type: 'STRING', values: [] },
      area: { type: 'FLOAT32', values: [] },
      lon: { type: 'FLOAT32', values: [] },
      lat: { type: 'FLOAT32', values: [] },
      source: { type: 'STRING', values: [] },
    },
  };
  tile.buildings.forEach((b, i) => {
    const rings: V2[][] = b.rings.map((r) => r.map(([lon, lat]) => proj.project(lon, lat)));
    const { wall, roof } = facadeColor(b);
    mb.extrudePolygon(rings, b.minHeight, b.height, {
      wallColor: wall,
      roofColor: roof,
      featureId: i,
      bottomCap: b.minHeight > 0,
    });
    maxH = Math.max(maxH, b.height);
    const P = props.properties;
    (P.id.values as number[]).push(b.id | 0);
    (P.name.values as string[]).push(b.name ?? '');
    (P.height.values as number[]).push(Math.round(b.height * 10) / 10);
    (P.min_height.values as number[]).push(b.minHeight);
    (P.levels.values as number[]).push(
      b.levels ?? Math.max(1, Math.round((b.height - b.minHeight) / floorHeight(b.type))),
    );
    (P.building.values as string[]).push(b.type);
    (P.district.values as string[]).push(b.district ?? '');
    (P.height_source.values as string[]).push(b.heightSource);
    (P.area.values as number[]).push(Math.round(b.area));
    (P.lon.values as number[]).push(b.centroid[0]);
    (P.lat.values as number[]).push(b.centroid[1]);
    (P.source.values as string[]).push(b.source);
  });
  const mesh = mb.toMeshData();
  // Root spans the whole municipality (±70 km) which does not fit int16 at 0.1 m; keep it float.
  const quantize = QUANTIZE && tile.level > 0;
  // Pick the finest unit (≥ 5 cm) that fits the tile extent into int16: 0.1 m for ~1 km L2 cells, 0.2 m for 6 km L1 cells.
  let maxAbs = 0;
  for (let i = 0; i < mesh.positions.length; i++) maxAbs = Math.max(maxAbs, Math.abs(mesh.positions[i]));
  const quantizeUnit = Math.max(0.05, Math.ceil(maxAbs / 32000 / 0.05) * 0.05);
  const glb = buildGlb(mesh, {
    propertyTable: props,
    roughness: 0.9,
    metallic: 0.0,
    name: tile.key,
    quantize,
    quantizeUnit,
  });
  return { glb, center, minH: 0, maxH, triangles: mesh.indices.length / 3 };
}

const rad = (d: number) => (d * Math.PI) / 180;

function bboxOf(buildings: Building[], pad = 0.0005): [number, number, number, number] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const b of buildings)
    for (const r of b.rings)
      for (const [x, y] of r) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
  return [w - pad, s - pad, e + pad, n + pad];
}

async function main() {
  const t0 = Date.now();
  console.log('Shanghai building pipeline');
  console.log(`  input: ${INPUT}\n  output: ${OUT}`);
  const stats: Stats = {
    input: 0,
    deduplicated: 0,
    droppedInvalid: 0,
    droppedTiny: 0,
    droppedOutlinesWithParts: 0,
    droppedLandmarks: 0,
    overtureInput: 0,
    overtureAdded: 0,
    overtureDuplicates: 0,
    sources: {},
    output: 0,
    heightSources: {},
    heightHistogram: {},
    tiles: { L0: 0, L1: 0, L2: 0 },
    totalTriangles: 0,
    totalBytes: 0,
    maxHeight: 0,
    extent: { west: 0, south: 0, east: 0, north: 0 },
  };

  console.log('Loading footprints…');
  const { features, parts } = await loadFeatures();
  console.log(`  ${features.length} buildings, ${parts.length} building:parts`);
  const [landmarks, districts] = await Promise.all([loadLandmarks(), loadDistricts()]);

  console.log('Cleaning + heights…');
  let buildings = toBuildings(features, parts, landmarks, districts, stats);
  features.length = 0;
  parts.length = 0;
  if (!args['no-overture']) {
    const overtureFeatures = await loadOverture();
    if (overtureFeatures.length) {
      const before = { ...stats };
      const overtureBuildings = toBuildings(overtureFeatures, [], landmarks, districts, stats, 'overture');
      stats.input = before.input; // count OSM polygons only in `input`
      stats.overtureInput = overtureBuildings.length;
      console.log('Merging Overture footprints (OSM stays authoritative)…');
      buildings = mergeOverture(buildings, overtureBuildings, stats);
      console.log(`  +${stats.overtureAdded} added, ${stats.overtureDuplicates} duplicates of OSM skipped`);
    }
  }
  for (const b of buildings) stats.sources[b.source] = (stats.sources[b.source] ?? 0) + 1;

  if (!args['no-cnbh']) await applyCnbhHeights(buildings, stats);
  stats.output = buildings.length;
  for (const b of buildings) {
    stats.heightSources[b.heightSource] = (stats.heightSources[b.heightSource] ?? 0) + 1;
    const bucket =
      b.height < 10
        ? '<10'
        : b.height < 25
          ? '10-25'
          : b.height < 60
            ? '25-60'
            : b.height < 150
              ? '60-150'
              : b.height < 300
                ? '150-300'
                : '300+';
    stats.heightHistogram[bucket] = (stats.heightHistogram[bucket] ?? 0) + 1;
    stats.maxHeight = Math.max(stats.maxHeight, b.height);
  }
  const ext = bboxOf(buildings, 0);
  stats.extent = { west: ext[0], south: ext[1], east: ext[2], north: ext[3] };

  console.log('Tiling…');
  const l0: Building[] = [];
  const l1 = new Map<string, Building[]>();
  const l2 = new Map<string, Building[]>();
  for (const b of buildings) {
    if (b.height >= L0_MIN_HEIGHT) l0.push(b);
    else if (b.height >= L1_MIN_HEIGHT || b.area >= L1_MIN_AREA) {
      const k = cellKey(b, L1_CELL);
      (l1.get(k) ?? l1.set(k, []).get(k)!).push(b);
    } else {
      const k = cellKey(b, L2_CELL);
      (l2.get(k) ?? l2.set(k, []).get(k)!).push(b);
    }
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'content'), { recursive: true });

  const writeTile = async (tile: Tile) => {
    const { glb, center, maxH, triangles } = buildTileGlb(tile);
    const file = `content/${tile.key}.glb`;
    await writeFile(path.join(OUT, file), glb);
    stats.totalTriangles += triangles;
    stats.totalBytes += glb.byteLength;
    const [w, s, e, n] = tile.bbox;
    return {
      uri: file,
      /** ABSOLUTE ENU→ECEF frame of the content. 3D Tiles `transform` is parent-relative, so callers must
       *  multiply by the inverse of the parent's computed transform (see relativeTo). */
      transform: enuToFixedFrame(center[0], center[1], 0),
      region: [rad(w), rad(s), rad(e), rad(n), 0, maxH + 1],
      count: tile.buildings.length,
    };
  };
  /** Express an absolute transform relative to a parent's computed (absolute) transform. */
  const relativeTo = (parentComputed: number[], absolute: number[]) =>
    mat4Multiply(mat4InvertRigid(parentComputed), absolute);

  // Root (written first: children transforms are expressed relative to it)
  const rootRegion = [
    rad(ext[0]) - 0.0005,
    rad(ext[1]) - 0.0005,
    rad(ext[2]) + 0.0005,
    rad(ext[3]) + 0.0005,
    0,
    stats.maxHeight + 5,
  ];
  let rootEntry: Record<string, unknown> = {};
  let rootComputed = MAT4_IDENTITY;
  if (l0.length) {
    const t = await writeTile({ key: 'L0_root', level: 0, buildings: l0, bbox: ext });
    rootEntry = { content: { uri: t.uri }, transform: t.transform };
    rootComputed = t.transform;
    stats.tiles.L0 = 1;
  }

  // L2 leaves grouped under their L1 parent cell (absolute transforms kept until the parent is known)
  const l2ByParent = new Map<string, Array<Record<string, unknown>>>();
  let done = 0;
  for (const [cell, cellBuildings] of l2) {
    for (const [key, bs] of splitCell(cell, cellBuildings)) {
      const t = await writeTile({ key: `L2_${key}`, level: 2, buildings: bs, bbox: bboxOf(bs) });
      const [px, py] = cell.split('_').map(Number);
      const parentKey = `${Math.floor((px * L2_CELL + 1e-9) / L1_CELL)}_${Math.floor((py * L2_CELL + 1e-9) / L1_CELL)}`;
      (l2ByParent.get(parentKey) ?? l2ByParent.set(parentKey, []).get(parentKey)!).push({
        boundingVolume: { region: t.region },
        geometricError: GEOMETRIC_ERROR.l2,
        refine: 'ADD',
        content: { uri: t.uri },
        transform: t.transform, // absolute for now; rewritten relative to the parent below
      });
      stats.tiles.L2++;
      if (++done % 500 === 0) console.log(`  L2 tiles: ${done} (${l2.size} cells)`);
    }
  }

  const l1Tiles: Array<Record<string, unknown>> = [];
  const parentKeys = new Set([...l1.keys(), ...l2ByParent.keys()]);
  for (const key of parentKeys) {
    const bs = l1.get(key) ?? [];
    const children = l2ByParent.get(key) ?? [];
    // region = union of own buildings + children regions
    let region: number[];
    let tileEntry: Record<string, unknown>;
    let l1Computed = rootComputed; // no own transform → inherits the root's
    if (bs.length) {
      // An over-full L1 cell keeps its first chunk as own content and pushes the rest down as extra children.
      const chunks = splitCell(key, bs);
      const [firstKey, firstBs] = chunks[0];
      const t = await writeTile({
        key: `L1_${firstKey}`,
        level: 1,
        buildings: firstBs,
        bbox: bboxOf(firstBs),
      });
      region = [...t.region];
      tileEntry = { content: { uri: t.uri }, transform: relativeTo(rootComputed, t.transform) };
      l1Computed = t.transform;
      stats.tiles.L1++;
      for (const [k, cbs] of chunks.slice(1)) {
        const c = await writeTile({ key: `L1_${k}`, level: 1, buildings: cbs, bbox: bboxOf(cbs) });
        children.push({
          boundingVolume: { region: c.region },
          geometricError: GEOMETRIC_ERROR.l1 / 2,
          refine: 'ADD',
          content: { uri: c.uri },
          transform: c.transform,
        });
        stats.tiles.L1++;
      }
    } else {
      region = [Infinity, Infinity, -Infinity, -Infinity, 0, 0];
      tileEntry = {};
    }
    for (const c of children) {
      c.transform = relativeTo(l1Computed, c.transform as number[]);
      const r = (c.boundingVolume as { region: number[] }).region;
      region[0] = Math.min(region[0], r[0]);
      region[1] = Math.min(region[1], r[1]);
      region[2] = Math.max(region[2], r[2]);
      region[3] = Math.max(region[3], r[3]);
      region[5] = Math.max(region[5], r[5]);
    }
    l1Tiles.push({
      boundingVolume: { region },
      geometricError: GEOMETRIC_ERROR.l1,
      refine: 'ADD',
      ...tileEntry,
      children,
    });
  }

  const tileset = {
    asset: {
      version: '1.1',
      generator: 'shanghai-3d pipeline',
      tilesetVersion: new Date().toISOString().slice(0, 10),
    },
    schema: {
      id: 'shanghai3d',
      classes: {
        building: {
          properties: {
            id: { type: 'SCALAR', componentType: 'INT32' },
            name: { type: 'STRING' },
            height: { type: 'SCALAR', componentType: 'FLOAT32' },
            min_height: { type: 'SCALAR', componentType: 'FLOAT32' },
            levels: { type: 'SCALAR', componentType: 'FLOAT32' },
            building: { type: 'STRING' },
            district: { type: 'STRING' },
            height_source: { type: 'STRING' },
            area: { type: 'SCALAR', componentType: 'FLOAT32' },
            lon: { type: 'SCALAR', componentType: 'FLOAT32' },
            lat: { type: 'SCALAR', componentType: 'FLOAT32' },
          },
        },
      },
    },
    geometricError: GEOMETRIC_ERROR.root * 4,
    root: {
      boundingVolume: { region: rootRegion },
      geometricError: GEOMETRIC_ERROR.root,
      refine: 'ADD',
      ...rootEntry,
      children: l1Tiles,
    },
    extras: { attribution: '© OpenStreetMap contributors (ODbL)', generated: new Date().toISOString() },
  };
  await writeFile(path.join(OUT, 'tileset.json'), JSON.stringify(tileset));
  await writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log('\nStatistics');
  console.log(`  input polygons        ${stats.input}`);
  console.log(`  output buildings      ${stats.output}`);
  console.log(
    `  dropped: invalid ${stats.droppedInvalid}, tiny ${stats.droppedTiny}, outlines-with-parts ${stats.droppedOutlinesWithParts}, landmark ${stats.droppedLandmarks}`,
  );
  console.log(`  data sources          ${JSON.stringify(stats.sources)}`);
  console.log(`  height sources        ${JSON.stringify(stats.heightSources)}`);
  console.log(`  height histogram      ${JSON.stringify(stats.heightHistogram)}`);
  console.log(`  tallest               ${stats.maxHeight.toFixed(0)} m`);
  console.log(`  tiles                 L0 ${stats.tiles.L0}, L1 ${stats.tiles.L1}, L2 ${stats.tiles.L2}`);
  console.log(`  triangles             ${stats.totalTriangles.toLocaleString()}`);
  console.log(`  total size            ${(stats.totalBytes / 1e6).toFixed(1)} MB`);
  console.log(`  time                  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
