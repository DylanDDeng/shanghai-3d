import { Cartesian3, PolygonHierarchy } from 'cesium';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';

const cache = new Map<string, Promise<FeatureCollection>>();

/** Fetch + cache a GeoJSON FeatureCollection. Throws on HTTP errors. */
export function loadGeoJson(url: string): Promise<FeatureCollection> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return (await r.json()) as FeatureCollection;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

export async function geoJsonExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

function ringToCartesians(ring: Position[], height: number): Cartesian3[] {
  const out: Cartesian3[] = [];
  for (const [lon, lat] of ring) out.push(Cartesian3.fromDegrees(lon, lat, height));
  return out;
}

export function polygonToHierarchy(coords: Position[][], height = 0): PolygonHierarchy | null {
  if (!coords.length || coords[0].length < 4) return null;
  const holes = coords
    .slice(1)
    .filter((r) => r.length >= 4)
    .map((r) => new PolygonHierarchy(ringToCartesians(r, height)));
  return new PolygonHierarchy(ringToCartesians(coords[0], height), holes);
}

/** Yield every polygon (as ring coordinate arrays) of a (Multi)Polygon feature. */
export function* iteratePolygons(geom: Geometry): Generator<Position[][]> {
  if (geom.type === 'Polygon') yield (geom as Polygon).coordinates;
  else if (geom.type === 'MultiPolygon') for (const p of (geom as MultiPolygon).coordinates) yield p;
  else if (geom.type === 'GeometryCollection') for (const g of geom.geometries) yield* iteratePolygons(g);
}

export function* iterateLines(geom: Geometry): Generator<Position[]> {
  if (geom.type === 'LineString') yield (geom as LineString).coordinates;
  else if (geom.type === 'MultiLineString') for (const l of (geom as MultiLineString).coordinates) yield l;
  else if (geom.type === 'Polygon') for (const r of (geom as Polygon).coordinates) yield r;
  else if (geom.type === 'MultiPolygon')
    for (const p of (geom as MultiPolygon).coordinates) for (const r of p) yield r;
  else if (geom.type === 'GeometryCollection') for (const g of geom.geometries) yield* iterateLines(g);
}

export function lineToCartesians(line: Position[], height = 0): Cartesian3[] {
  const flat: number[] = [];
  for (const [lon, lat] of line) flat.push(lon, lat, height);
  return Cartesian3.fromDegreesArrayHeights(flat);
}

export function featureProp<T = unknown>(f: Feature, key: string): T | undefined {
  return (f.properties ?? {})[key] as T | undefined;
}
