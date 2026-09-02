/** Prints the dominant edge orientation (degrees clockwise from north) of OSM building ways — for landmark model headings. */
import { overpass } from '../lib/overpass.js';
const ids = (process.argv[2] ?? '10691100,376075961,165792123,438483942,423304682').split(',');
async function main() {
  const res = await overpass(
    `[out:json][timeout:60];(${ids.map((i) => `way(${i});`).join('')});out geom tags;`,
  );
  for (const w of res.elements as Array<{
    id: number;
    tags: Record<string, string>;
    geometry: Array<{ lat: number; lon: number }>;
  }>) {
    const g = w.geometry;
    let best = 0,
      bestLen = 0;
    let cx = 0,
      cy = 0;
    for (let i = 0; i < g.length - 1; i++) {
      const dx = (g[i + 1].lon - g[i].lon) * Math.cos((g[i].lat * Math.PI) / 180) * 111320;
      const dy = (g[i + 1].lat - g[i].lat) * 110540;
      const len = Math.hypot(dx, dy);
      if (len > bestLen) {
        bestLen = len;
        best = (Math.atan2(dx, dy) * 180) / Math.PI;
      }
      cx += g[i].lon;
      cy += g[i].lat;
    }
    const n = g.length - 1;
    const heading = ((best % 180) + 180) % 180;
    console.log(
      w.id,
      w.tags.name ?? '',
      'center',
      (cx / n).toFixed(5),
      (cy / n).toFixed(5),
      'longest edge',
      bestLen.toFixed(0),
      'm heading',
      heading.toFixed(1),
      '°',
    );
  }
}
main();
