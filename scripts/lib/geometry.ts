/**
 * Small mesh-building kit (glTF y-up, metres). Used by the building extruder and the procedural landmarks.
 * All faces are emitted with flat normals so extruded architecture reads crisply.
 */
import earcut from 'earcut';
import type { MeshData } from './gltf.js';

export type V3 = [number, number, number];
export type V2 = [number, number];

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  featureIds: number[] = [];
  indices: number[] = [];
  private useColors: boolean;
  private useFeatureIds: boolean;

  constructor(opts: { colors?: boolean; featureIds?: boolean } = {}) {
    this.useColors = opts.colors ?? false;
    this.useFeatureIds = opts.featureIds ?? false;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Push a triangle with a flat normal. `a,b,c` counter-clockwise as seen from outside. */
  triangle(a: V3, b: V3, c: V3, color?: V3, featureId = 0): void {
    const n = normal(a, b, c);
    const base = this.vertexCount;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      if (this.useColors) this.colors.push(...(color ?? [1, 1, 1]));
      if (this.useFeatureIds) this.featureIds.push(featureId);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  quad(a: V3, b: V3, c: V3, d: V3, color?: V3, featureId = 0): void {
    const n = normal(a, b, c);
    const base = this.vertexCount;
    for (const p of [a, b, c, d]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      if (this.useColors) this.colors.push(...(color ?? [1, 1, 1]));
      if (this.useFeatureIds) this.featureIds.push(featureId);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Extrude a polygon (outer ring + holes, in XZ plane; x=east, z=-north i.e. glTF) from y=bottom to y=top.
   * Rings may be in any winding. Bottom cap is only emitted when `bottomCap` is true (e.g. floating parts).
   */
  extrudePolygon(
    rings: V2[][],
    bottom: number,
    top: number,
    opts: { wallColor?: V3; roofColor?: V3; featureId?: number; bottomCap?: boolean } = {},
  ): void {
    if (!rings.length || rings[0].length < 3 || top <= bottom) return;
    const fid = opts.featureId ?? 0;
    // Normalise windings: outer CCW (in x/-z plane, i.e. CCW when viewed from above), holes CW.
    const norm = rings.map((r, i) => {
      const ccw = signedArea(r) > 0;
      return (i === 0) === ccw ? r : [...r].reverse();
    });
    // Walls
    for (const ring of norm) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        if (p[0] === q[0] && p[1] === q[1]) continue;
        // ring coords are (x, north); glTF z = -north
        const a: V3 = [p[0], bottom, -p[1]];
        const b: V3 = [q[0], bottom, -q[1]];
        const c: V3 = [q[0], top, -q[1]];
        const d: V3 = [p[0], top, -p[1]];
        this.quad(a, b, c, d, opts.wallColor, fid);
      }
    }
    // Roof via earcut
    const flat: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < norm.length; r++) {
      if (r > 0) holes.push(flat.length / 2);
      for (const p of norm[r]) flat.push(p[0], p[1]);
    }
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    const base = this.vertexCount;
    for (let i = 0; i < flat.length; i += 2) {
      this.positions.push(flat[i], top, -flat[i + 1]);
      this.normals.push(0, 1, 0);
      if (this.useColors) this.colors.push(...(opts.roofColor ?? opts.wallColor ?? [1, 1, 1]));
      if (this.useFeatureIds) this.featureIds.push(fid);
    }
    for (let i = 0; i < tri.length; i += 3) {
      // earcut gives CCW in (x, north) space; in glTF (x, -north) that flips → swap to keep up-facing
      this.indices.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]);
    }
    if (opts.bottomCap) {
      const b2 = this.vertexCount;
      for (let i = 0; i < flat.length; i += 2) {
        this.positions.push(flat[i], bottom, -flat[i + 1]);
        this.normals.push(0, -1, 0);
        if (this.useColors) this.colors.push(...(opts.wallColor ?? [1, 1, 1]));
        if (this.useFeatureIds) this.featureIds.push(fid);
      }
      for (let i = 0; i < tri.length; i += 3)
        this.indices.push(b2 + tri[i], b2 + tri[i + 1], b2 + tri[i + 2]);
    }
  }

  /** Loft between successive closed profiles (each an array of V3 with the same length). */
  loft(profiles: V3[][], color?: V3, featureId = 0, closeTop = true, closeBottom = false): void {
    for (let s = 0; s < profiles.length - 1; s++) {
      const a = profiles[s];
      const b = profiles[s + 1];
      const n = a.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.quad(a[i], a[j], b[j], b[i], color, featureId);
      }
    }
    if (closeTop) this.cap(profiles[profiles.length - 1], true, color, featureId);
    if (closeBottom) this.cap(profiles[0], false, color, featureId);
  }

  private cap(ring: V3[], up: boolean, color?: V3, featureId = 0): void {
    const c = centroid(ring);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      if (up) this.triangle(c, ring[i], ring[j], color, featureId);
      else this.triangle(c, ring[j], ring[i], color, featureId);
    }
  }

  box(
    cx: number,
    cz: number,
    w: number,
    d: number,
    bottom: number,
    top: number,
    color?: V3,
    rotationDeg = 0,
    fid = 0,
  ): void {
    const r = (rotationDeg * Math.PI) / 180;
    const cs = Math.cos(r);
    const sn = Math.sin(r);
    const corners: V2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, y]) => [cx + x * cs - y * sn, -cz + x * sn + y * cs] as V2); // ring in (x, north) space
    this.extrudePolygon([corners], bottom, top, {
      wallColor: color,
      roofColor: color,
      featureId: fid,
      bottomCap: bottom > 0,
    });
  }

  cylinder(
    cx: number,
    cz: number,
    r0: number,
    r1: number,
    bottom: number,
    top: number,
    segments = 24,
    color?: V3,
    fid = 0,
  ): void {
    const a: V3[] = [];
    const b: V3[] = [];
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      a.push([cx + r0 * Math.cos(t), bottom, cz + r0 * Math.sin(t)]);
      b.push([cx + r1 * Math.cos(t), top, cz + r1 * Math.sin(t)]);
    }
    // ensure outward winding: profile should be CCW viewed from +y → reverse
    this.loft([a.reverse(), b.reverse()], color, fid, r1 > 0.01, bottom > 0);
  }

  sphere(cx: number, cy: number, cz: number, r: number, color?: V3, seg = 20, rings = 14, fid = 0): void {
    const profiles: V3[][] = [];
    for (let j = 1; j < rings; j++) {
      const phi = (j / rings) * Math.PI;
      const y = cy - r * Math.cos(phi);
      const rr = r * Math.sin(phi);
      const ring: V3[] = [];
      for (let i = 0; i < seg; i++) {
        const t = -(i / seg) * Math.PI * 2;
        ring.push([cx + rr * Math.cos(t), y, cz + rr * Math.sin(t)]);
      }
      profiles.push(ring);
    }
    this.loft(profiles, color, fid, false, false);
    const top: V3 = [cx, cy + r, cz];
    const bot: V3 = [cx, cy - r, cz];
    const first = profiles[0];
    const last = profiles[profiles.length - 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.triangle(bot, first[j], first[i], color, fid);
      this.triangle(top, last[i], last[j], color, fid);
    }
  }

  toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: this.useColors ? new Float32Array(this.colors) : undefined,
      featureIds: this.useFeatureIds ? new Float32Array(this.featureIds) : undefined,
      indices: new Uint32Array(this.indices),
    };
  }
}

export function normal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  return [nx, ny, nz];
}

export function signedArea(ring: V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(ring: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of ring) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / ring.length, c[1] / ring.length, c[2] / ring.length];
}

// ------------------------------------------------------------------ geodesy helpers (WGS84)

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = 2 * F - F * F;

export function toEcef(lonDeg: number, latDeg: number, h = 0): V3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sl = Math.sin(lat),
    cl = Math.cos(lat);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  return [(N + h) * cl * Math.cos(lon), (N + h) * cl * Math.sin(lon), (N * (1 - E2) + h) * sl];
}

/** Column-major 4x4 east-north-up frame at lon/lat (same as Cesium.Transforms.eastNorthUpToFixedFrame). */
export function enuToFixedFrame(lonDeg: number, latDeg: number, h = 0): number[] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sl = Math.sin(lon),
    cl = Math.cos(lon),
    sp = Math.sin(lat),
    cp = Math.cos(lat);
  const east = [-sl, cl, 0];
  const north = [-sp * cl, -sp * sl, cp];
  const up = [cp * cl, cp * sl, sp];
  const o = toEcef(lonDeg, latDeg, h);
  return [
    east[0],
    east[1],
    east[2],
    0,
    north[0],
    north[1],
    north[2],
    0,
    up[0],
    up[1],
    up[2],
    0,
    o[0],
    o[1],
    o[2],
    1,
  ];
}

/** Local ENU metres of a lon/lat relative to an origin (accurate to mm at city-tile scale). */
export class LocalProjector {
  private readonly o: V3;
  private readonly east: V3;
  private readonly north: V3;
  constructor(
    readonly lon0: number,
    readonly lat0: number,
  ) {
    this.o = toEcef(lon0, lat0, 0);
    const lon = (lon0 * Math.PI) / 180;
    const lat = (lat0 * Math.PI) / 180;
    this.east = [-Math.sin(lon), Math.cos(lon), 0];
    this.north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  }
  /** returns [east, north] metres */
  project(lon: number, lat: number): V2 {
    const p = toEcef(lon, lat, 0);
    const dx = p[0] - this.o[0],
      dy = p[1] - this.o[1],
      dz = p[2] - this.o[2];
    return [
      dx * this.east[0] + dy * this.east[1] + dz * this.east[2],
      dx * this.north[0] + dy * this.north[1] + dz * this.north[2],
    ];
  }
}

// ------------------------------------------------------------------ 4x4 helpers (column-major, like glTF/Cesium)

export function mat4Multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

/** Inverse of a rigid transform (rotation + translation, no scale). */
export function mat4InvertRigid(m: number[]): number[] {
  const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; // columns
  // R^T
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const t = [m[12], m[13], m[14]];
  const nt = [
    -(rt[0] * t[0] + rt[3] * t[1] + rt[6] * t[2]),
    -(rt[1] * t[0] + rt[4] * t[1] + rt[7] * t[2]),
    -(rt[2] * t[0] + rt[5] * t[1] + rt[8] * t[2]),
  ];
  return [rt[0], rt[1], rt[2], 0, rt[3], rt[4], rt[5], 0, rt[6], rt[7], rt[8], 0, nt[0], nt[1], nt[2], 1];
}

export const MAT4_IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
