/** Lists raw OSM buildings taller than --min (default 250 m) with their distance to registered landmarks. */
import { readFile, readdir } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';

const min = Number(process.argv.find((a) => a.startsWith('--min='))?.slice(6) ?? 250);
async function main() {
  const lms = JSON.parse(await readFile('public/models/landmarks/landmarks.json', 'utf8')) as Array<{
    id: string;
    longitude: number;
    latitude: number;
  }>;
  const files = (await readdir('data/raw')).filter((f) => f.startsWith('buildings-'));
  for (const f of files) {
    const fc = osmtogeojson(JSON.parse(await readFile('data/raw/' + f, 'utf8')), {
      flatProperties: true,
    }) as FeatureCollection;
    for (const ft of fc.features as Feature[]) {
      const p = (ft.properties ?? {}) as Record<string, string>;
      const h = parseFloat(p.height);
      if (!(h > min)) continue;
      if (ft.geometry.type !== 'Polygon' && ft.geometry.type !== 'MultiPolygon') continue;
      const c = turf.centroid(ft).geometry.coordinates;
      const near = lms
        .map((l) => [l.id, turf.distance(c, [l.longitude, l.latitude], { units: 'meters' })] as const)
        .filter(([, d]) => d < 300)
        .map(([id, d]) => `${id}:${d.toFixed(0)}m`)
        .join(' ');
      console.log(
        ft.id,
        p.name ?? '',
        p.height,
        p['building:part'] ? 'PART' : '',
        p.building ?? '',
        c.map((x) => x.toFixed(5)).join(','),
        'area',
        turf.area(ft).toFixed(0),
        '|',
        near,
      );
    }
  }
}
main();
