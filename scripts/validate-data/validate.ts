/**
 * Validates generated data in public/: GeoJSON sanity (WGS84 bounds, feature counts), the 3D Tiles tileset
 * (schema, bounding regions, content files present, transforms parent-relative), and landmark GLBs.
 * Usage: npx tsx scripts/validate-data/validate.ts   (exit code 1 on failure)
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FeatureCollection } from 'geojson';
import validator from 'gltf-validator';

/** Contiguous municipality incl. its maritime boundary (Pudong/Chongming polygons reach ~123.2°E). */
const SH = { west: 120.5, south: 30.4, east: 123.3, north: 32.1 }; // extract bbox + complete-ways margin
let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function geojson(name: string, min: number) {
  const p = path.resolve('public/geojson', `${name}.geojson`);
  if (!(await exists(p))) return fail(`${name}.geojson missing`);
  const fc = JSON.parse(await readFile(p, 'utf8')) as FeatureCollection;
  if (fc.type !== 'FeatureCollection') return fail(`${name}: not a FeatureCollection`);
  if (fc.features.length < min)
    return fail(`${name}: only ${fc.features.length} features (expected ≥ ${min})`);
  let outside = 0;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [lon, lat] = c as number[];
      if (lon < SH.west || lon > SH.east || lat < SH.south || lat > SH.north) outside++;
    } else for (const x of c as unknown[]) walk(x);
  };
  for (const f of fc.features) walk((f.geometry as { coordinates: unknown }).coordinates);
  if (outside)
    return fail(
      `${name}: ${outside} coordinates outside Shanghai bbox (GCJ-02 contamination or stray rings?)`,
    );
  ok(`${name}.geojson: ${fc.features.length} features, all coordinates within Shanghai`);
}

async function tileset() {
  const dir = path.resolve('public/tiles/buildings');
  const p = path.join(dir, 'tileset.json');
  if (!(await exists(p))) return fail('tileset.json missing (run npm run data:buildings)');
  const ts = JSON.parse(await readFile(p, 'utf8'));
  if (ts.asset?.version !== '1.1') fail(`tileset asset.version is ${ts.asset?.version}, expected 1.1`);
  let tiles = 0;
  let missing = 0;
  let badRegion = 0;
  let bigTransform = 0;
  const walk = async (t: Record<string, unknown>, depth: number) => {
    tiles++;
    const r = (t.boundingVolume as { region?: number[] })?.region;
    if (!r || r.length !== 6 || r[0] >= r[2] || r[1] >= r[3] || r[4] > r[5]) badRegion++;
    const tx = t.transform as number[] | undefined;
    if (tx && depth > 0 && Math.hypot(tx[12], tx[13], tx[14]) > 200_000) bigTransform++; // child transforms must be parent-relative
    const uri = (t.content as { uri?: string })?.uri;
    if (uri && !(await exists(path.join(dir, uri)))) missing++;
    for (const c of (t.children as Record<string, unknown>[] | undefined) ?? []) await walk(c, depth + 1);
  };
  await walk(ts.root, 0);
  if (missing) fail(`${missing} tile content files missing`);
  if (badRegion) fail(`${badRegion} tiles with invalid bounding regions`);
  if (bigTransform) fail(`${bigTransform} child tiles carry absolute (not parent-relative) transforms`);
  if (!missing && !badRegion && !bigTransform)
    ok(`tileset.json: ${tiles} tiles, all content present, regions valid, transforms parent-relative`);
  const stats = path.join(dir, 'stats.json');
  if (await exists(stats)) {
    const s = JSON.parse(await readFile(stats, 'utf8'));
    ok(`buildings: ${s.output} (${JSON.stringify(s.heightSources)}), ${(s.totalBytes / 1e6).toFixed(0)} MB`);
    if (s.heightSources.estimated / s.output > 0.97)
      console.warn(
        '  ! more than 97% of heights are estimated — height enrichment (CNBH-10m / 3D-GloBFP) recommended',
      );
    if (s.sources) ok(`building sources: ${JSON.stringify(s.sources)}`);
  }
}

async function landmarks() {
  const p = path.resolve('public/models/landmarks/landmarks.json');
  if (!(await exists(p))) return fail('landmarks.json missing (run npm run data:landmarks)');
  const defs = JSON.parse(await readFile(p, 'utf8')) as Array<{
    id: string;
    model: string;
    longitude: number;
    latitude: number;
    license: string;
    source: string;
  }>;
  for (const d of defs) {
    const f = path.resolve('public/models/landmarks', d.model);
    if (!(await exists(f))) {
      fail(`${d.id}: model ${d.model} missing`);
      continue;
    }
    if (!d.license || !d.source) fail(`${d.id}: license/source metadata missing`);
    if (d.longitude < SH.west || d.longitude > SH.east || d.latitude < SH.south || d.latitude > SH.north)
      fail(`${d.id}: position outside Shanghai`);
    const report = await validator.validateBytes(new Uint8Array(await readFile(f)), { maxIssues: 3 });
    if (report.issues.numErrors)
      fail(`${d.id}: glTF validator errors ${JSON.stringify(report.issues.messages.slice(0, 2))}`);
  }
  ok(`landmarks.json: ${defs.length} entries, models valid`);
}

async function main() {
  console.log('Validating data…');
  await geojson('shanghai-boundary', 1);
  await geojson('districts', 16);
  await geojson('water', 100);
  await geojson('roads-major', 1000);
  await geojson('roads-inner', 500);
  await geojson('metro-lines', 10);
  await geojson('metro-stations', 100);
  await geojson('parks', 100);
  await tileset();
  await landmarks();
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}
main();
