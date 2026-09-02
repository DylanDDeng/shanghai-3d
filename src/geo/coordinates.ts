/**
 * Coordinate utilities. The project's internal geographic CRS is WGS84 (EPSG:4326).
 * Cesium's Cartesian3 is Earth-Centered Earth-Fixed (ECEF) on the WGS84 ellipsoid.
 *
 * GCJ-02 / BD-09 helpers exist ONLY as a compatibility module for ingesting Chinese-sourced data;
 * never store GCJ-02 coordinates internally.
 */
import { Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath } from 'cesium';

export interface LonLatHeight {
  longitude: number; // degrees
  latitude: number; // degrees
  height?: number; // metres above the WGS84 ellipsoid
}

export function wgs84ToCartesian(longitude: number, latitude: number, height = 0): Cartesian3 {
  return Cartesian3.fromDegrees(longitude, latitude, height, Ellipsoid.WGS84);
}

export function longitudeLatitudeHeightToCartesian(p: LonLatHeight): Cartesian3 {
  return wgs84ToCartesian(p.longitude, p.latitude, p.height ?? 0);
}

export function cartesianToWgs84(c: Cartesian3): Required<LonLatHeight> {
  const carto = Cartographic.fromCartesian(c, Ellipsoid.WGS84);
  return {
    longitude: CesiumMath.toDegrees(carto.longitude),
    latitude: CesiumMath.toDegrees(carto.latitude),
    height: carto.height,
  };
}

/** Great-circle-ish distance in metres between two lon/lat points (haversine, fine for city scale). */
export function distanceMeters(a: LonLatHeight, b: LonLatHeight): number {
  const R = 6371008.8;
  const dLat = CesiumMath.toRadians(b.latitude - a.latitude);
  const dLon = CesiumMath.toRadians(b.longitude - a.longitude);
  const la1 = CesiumMath.toRadians(a.latitude);
  const la2 = CesiumMath.toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------------------------
// GCJ-02 compatibility (Chinese "Mars" coordinates). Algorithm is the widely published approximation.
// ---------------------------------------------------------------------------------------------
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.006693421622965943; // first eccentricity squared (Krasovsky 1940)

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
function delta(lon: number, lat: number): [number, number] {
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [dLon, dLat];
}

export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat];
  const [dLon, dLat] = delta(lon, lat);
  return [lon + dLon, lat + dLat];
}

/** Iterative inverse; accurate to ~1e-6 degrees. */
export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat];
  let wLon = lon;
  let wLat = lat;
  for (let i = 0; i < 5; i++) {
    const [gLon, gLat] = wgs84ToGcj02(wLon, wLat);
    wLon -= gLon - lon;
    wLat -= gLat - lat;
  }
  return [wLon, wLat];
}
