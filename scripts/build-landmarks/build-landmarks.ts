/**
 * Generates low/medium-fidelity but recognizable procedural GLB models for Shanghai's key landmarks
 * plus the registry public/models/landmarks/landmarks.json consumed by LandmarksLayer.
 *
 * These are ORIGINAL parametric approximations built from public dimensions (heights, floor counts,
 * footprint sizes as tagged in OpenStreetMap / published architecture references), not downloaded
 * third-party models. Any entry can be replaced by a licensed high-fidelity asset by editing the JSON.
 *
 * Usage: npx tsx scripts/build-landmarks/build-landmarks.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildGlb } from '../lib/gltf.js';
import { MeshBuilder, type V2, type V3 } from '../lib/geometry.js';

const OUT = path.resolve('public/models/landmarks');

interface Landmark {
  id: string;
  name: string;
  nameEn: string;
  longitude: number;
  latitude: number;
  height: number;
  built?: string;
  description?: string;
  heading?: number;
  osmIds?: number[];
  build: () => MeshBuilder;
}

const GLASS: V3 = [0.62, 0.74, 0.86];
const GLASS_DARK: V3 = [0.42, 0.52, 0.66];
const STEEL: V3 = [0.78, 0.8, 0.83];
const CONCRETE: V3 = [0.82, 0.8, 0.76];
const PEARL: V3 = [0.85, 0.35, 0.5];
const PEARL_TOP: V3 = [0.9, 0.5, 0.6];
const STONE: V3 = [0.86, 0.82, 0.72];

function ring(cx: number, cz: number, y: number, fn: (t: number) => number, n: number, rot = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = -(i / n) * Math.PI * 2; // clockwise from above → outward normals in loft
    const r = fn(t);
    out.push([cx + r * Math.cos(t + rot), y, cz + r * Math.sin(t + rot)]);
  }
  return out;
}

/** Shanghai Tower: 632 m, twisted (~120°) tapering rounded-triangle envelope over a 9-zone core. */
function shanghaiTower(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  const H = 632;
  const segments = 72;
  const profiles: V3[][] = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const y = t * 580; // envelope stops at ~580 m; crown continues
    const scale = 1 - 0.5 * t;
    const rot = (t * 120 * Math.PI) / 180;
    // rounded triangle: r(θ) = R(1 + k cos 3θ)
    profiles.push(ring(0, 0, y, (th) => 62 * scale * (1 + 0.16 * Math.cos(3 * th)), 60, rot));
  }
  m.loft(profiles, GLASS, 0, true, false);
  // Inner core tower visible through the crown
  m.cylinder(0, 0, 22, 14, 560, 610, 24, GLASS_DARK);
  m.cylinder(0, 0, 14, 8, 610, H, 16, STEEL);
  // Podium
  m.box(0, 0, 150, 120, 0, 28, CONCRETE);
  return m;
}

/** Oriental Pearl Tower: 468 m, three 9 m columns, two large spheres, a string of small pearls, mast. */
function orientalPearl(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  const R = 22;
  // Base: three big diagonal columns from ground to the lower sphere, plus three small base spheres
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    // slanted column approximated by a loft
    const bottom = ring(x * 1.9, z * 1.9, 0, () => 4.5, 16);
    const top = ring(x * 0.5, z * 0.5, 115, () => 4.5, 16);
    m.loft([bottom, top], CONCRETE, 0, false, false);
    m.sphere(x * 1.9, 10, z * 1.9, 9, PEARL, 18, 12);
  }
  m.cylinder(0, 0, 9, 9, 0, 300, 24, CONCRETE); // core column
  m.sphere(0, 112, 0, 25, PEARL, 32, 22); // lower sphere (50 m)
  for (let i = 0; i < 5; i++) m.sphere(0, 150 + i * 22, 0, 5.5, PEARL_TOP, 14, 10); // "pearl string"
  m.sphere(0, 263, 0, 22.5, PEARL, 32, 22); // upper sphere (45 m)
  m.cylinder(0, 0, 4.5, 4.5, 280, 350, 16, STEEL);
  m.sphere(0, 350, 0, 8, PEARL_TOP, 18, 12); // top capsule
  m.cylinder(0, 0, 2.2, 0.6, 356, 468, 12, STEEL); // antenna
  // Podium / base ring
  m.cylinder(0, 0, 60, 60, 0, 6, 32, CONCRETE);
  return m;
}

/** Jin Mao Tower: 421 m, stepped setbacks on a square plan (base 53 m) with a lantern-like spire. */
function jinMao(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  // 8 setback tiers, heights follow the tower's 8-based rhythm
  const tiers: Array<[number, number, number]> = [
    // [bottom, top, half-width]
    [0, 104, 27.5],
    [104, 176, 26],
    [176, 232, 24.5],
    [232, 280, 23],
    [280, 320, 21.5],
    [320, 352, 20],
    [352, 376, 18],
    [376, 392, 16],
  ];
  for (const [b, t, w] of tiers) {
    m.box(0, 0, w * 2, w * 2, b, t, GLASS_DARK, 0);
    m.box(0, 0, w * 2 * 0.86, w * 2 * 0.86, b, t + 2, GLASS, 45); // rotated square gives the faceted look
  }
  // spire
  const spire = [ring(0, 0, 392, () => 12, 8), ring(0, 0, 408, () => 6, 8), ring(0, 0, 421, () => 0.8, 8)];
  m.loft(spire, STEEL, 0, true, false);
  m.box(0, 0, 110, 90, 0, 24, CONCRETE); // podium
  return m;
}

/** Shanghai World Financial Center: 492 m, square base lofting into a thin blade with a trapezoid aperture. */
function swfc(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  const base = 58;
  const profiles: V3[][] = [];
  const n = 40;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const y = t * 400;
    const depth = base * (1 - 0.86 * t); // becomes a blade
    const w = base;
    profiles.push([
      [-w / 2, y, -depth / 2],
      [-w / 2, y, depth / 2],
      [w / 2, y, depth / 2],
      [w / 2, y, -depth / 2],
    ] as V3[]);
  }
  m.loft(profiles, GLASS, 0, false, false);
  // Top 92 m: two legs with the famous trapezoid opening, then a bridge
  const legW = 12;
  const ap = 46; // aperture width at top
  for (const side of [-1, 1]) {
    const leg: V3[][] = [];
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      const y = 400 + t * 80;
      const inner = side * (base / 2 - legW - (base / 2 - legW - ap / 2) * t);
      const outer = side * (base / 2 - 2 * t);
      const d = 8;
      const xs = side > 0 ? [inner, outer] : [outer, inner];
      leg.push([
        [xs[0], y, -d / 2],
        [xs[0], y, d / 2],
        [xs[1], y, d / 2],
        [xs[1], y, -d / 2],
      ] as V3[]);
    }
    m.loft(leg, GLASS_DARK, 0, true, false);
  }
  m.box(0, 0, base - 4, 8, 480, 492, GLASS_DARK); // top bridge
  m.box(0, 0, 100, 90, 0, 20, CONCRETE); // podium
  return m;
}

/** Shanghai IFC (Tower 2, 260 m): chamfered glass tower; the 250 m north tower remains an OSM extrusion. */
function ifc(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  const tower = (cx: number, cz: number, h: number, w: number) => {
    const ch = 6;
    const rings: V3[][] = [];
    for (const [y, s] of [
      [0, 1],
      [h * 0.8, 1],
      [h, 0.82],
    ] as V2[]) {
      const hw = (w / 2) * s;
      rings.push(
        [
          [-hw + ch, y, -hw],
          [-hw, y, -hw + ch],
          [-hw, y, hw - ch],
          [-hw + ch, y, hw],
          [hw - ch, y, hw],
          [hw, y, hw - ch],
          [hw, y, -hw + ch],
          [hw - ch, y, -hw],
        ].map(([x, yy, z]) => [x + cx, yy, z + cz] as V3),
      );
    }
    m.loft(rings, GLASS, 0, true, false);
  };
  tower(0, 0, 260, 50);
  m.box(0, 0, 70, 70, 0, 22, CONCRETE);
  return m;
}

/** Shanghai Exhibition Center: 1955 Sino-Soviet neoclassical block with a gilded central tower and spire. */
function exhibitionCenter(): MeshBuilder {
  const m = new MeshBuilder({ colors: true });
  m.box(0, 0, 150, 70, 0, 18, STONE); // main block
  m.box(-90, 0, 40, 60, 0, 14, STONE); // wings
  m.box(90, 0, 40, 60, 0, 14, STONE);
  m.box(0, 0, 44, 44, 18, 38, STONE); // central block
  m.cylinder(0, 0, 14, 12, 38, 62, 16, STONE); // drum
  m.cylinder(0, 0, 8, 6, 62, 78, 12, STONE);
  const spire = [ring(0, 0, 78, () => 5, 8), ring(0, 0, 96, () => 1.2, 8), ring(0, 0, 106, () => 0.3, 8)];
  m.loft(spire, [0.95, 0.8, 0.35], 0, true, false);
  m.sphere(0, 106, 0, 1.6, [0.95, 0.2, 0.2]);
  return m;
}

const LANDMARKS: Landmark[] = [
  {
    id: 'shanghai-tower',
    name: '上海中心大厦',
    nameEn: 'Shanghai Tower',
    longitude: 121.50129,
    latitude: 31.2356,
    height: 632,
    built: '2015',
    description:
      'The tallest building in China (632 m, 128 floors). Its twisting, tapering glass envelope reduces wind loads by 24%. Designed by Gensler.',
    heading: 0,
    build: shanghaiTower,
  },
  {
    id: 'oriental-pearl',
    name: '东方明珠广播电视塔',
    nameEn: 'Oriental Pearl Tower',
    longitude: 121.49526,
    latitude: 31.24189,
    height: 468,
    built: '1994',
    description:
      'A 468 m TV tower of eleven spheres on three columns — the icon of the Lujiazui skyline. Designed by Jiang Huan Chen.',
    heading: 0,
    build: orientalPearl,
  },
  {
    id: 'jin-mao',
    name: '金茂大厦',
    nameEn: 'Jin Mao Tower',
    longitude: 121.50141,
    latitude: 31.23726,
    height: 421,
    built: '1999',
    description:
      '421 m, 88 floors. Its stepped, pagoda-like setbacks follow rhythms of eight. Designed by SOM.',
    heading: 0,
    build: jinMao,
  },
  {
    id: 'swfc',
    name: '上海环球金融中心',
    nameEn: 'Shanghai World Financial Center',
    longitude: 121.50301,
    latitude: 31.23657,
    height: 492,
    built: '2008',
    description:
      '492 m, 101 floors. The square base twists into a blade topped by a trapezoid aperture. Designed by KPF.',
    heading: -5,
    build: swfc,
  },
  {
    id: 'ifc',
    name: '上海国际金融中心',
    nameEn: 'Shanghai IFC Tower 2',
    longitude: 121.49776,
    latitude: 31.2391,
    height: 260,
    built: '2010',
    description:
      'South tower of the twin-tower Shanghai IFC complex (260 m / 250 m) above the IFC Mall, designed by Cesar Pelli.',
    heading: 22.6,
    build: ifc,
  },
  {
    id: 'exhibition-center',
    name: '上海展览中心',
    nameEn: 'Shanghai Exhibition Center',
    longitude: 121.44804,
    latitude: 31.22709,
    height: 106,
    built: '1955',
    description:
      'Former Sino-Soviet Friendship Building, a neoclassical exhibition hall crowned by a gilded 106 m spire.',
    heading: -23,
    build: exhibitionCenter,
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const registry = [];
  for (const lm of LANDMARKS) {
    const mesh = lm.build().toMeshData();
    const glb = buildGlb(mesh, { name: lm.id, roughness: 0.5, metallic: 0.15 });
    const file = `${lm.id}.glb`;
    await writeFile(path.join(OUT, file), glb);
    console.log(`  ${file}: ${(glb.byteLength / 1024).toFixed(0)} KB, ${mesh.indices.length / 3} tris`);
    registry.push({
      id: lm.id,
      name: lm.name,
      nameEn: lm.nameEn,
      longitude: lm.longitude,
      latitude: lm.latitude,
      height: lm.height,
      built: lm.built,
      description: lm.description,
      model: file,
      heading: lm.heading ?? 0,
      scale: 1,
      /** Footprints within this radius (m) are dropped from the procedural tileset. */
      exclusionRadius: lm.id === 'exhibition-center' ? 160 : lm.id === 'oriental-pearl' ? 90 : 55,
      source:
        'Procedural model generated by scripts/build-landmarks (dimensions from public references / OSM tags)',
      license: 'CC0-1.0 (project-generated geometry)',
      osmIds: lm.osmIds ?? [],
    });
  }
  await writeFile(path.join(OUT, 'landmarks.json'), JSON.stringify(registry, null, 2));
  console.log(`  landmarks.json: ${registry.length} entries`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
