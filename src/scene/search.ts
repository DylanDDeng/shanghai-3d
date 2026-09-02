import { DISTRICTS, PLACES } from '../geo/shanghai';
import type { SearchResult } from '../types';

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s'’\-_]/g, '');
}

/** Static search index over curated places + districts; metro stations are merged in by ShanghaiScene. */
export function searchStatic(query: string, limit = 8): SearchResult[] {
  const q = norm(query);
  if (!q) return [];
  const scored: Array<{ r: SearchResult; score: number }> = [];
  for (const p of PLACES) {
    const names = [p.name, p.nameEn, ...(p.aliases ?? [])];
    let score = 0;
    for (const n of names) {
      const nn = norm(n);
      if (nn === q) score = Math.max(score, 100);
      else if (nn.startsWith(q)) score = Math.max(score, 80);
      else if (nn.includes(q)) score = Math.max(score, 60);
    }
    if (score)
      scored.push({
        r: { id: p.id, label: p.name, sublabel: p.nameEn, kind: p.kind, position: p.position },
        score,
      });
  }
  for (const d of DISTRICTS) {
    const names = [d.name, d.nameEn, d.name.replace(/[区新]/g, '')];
    let score = 0;
    for (const n of names) {
      const nn = norm(n);
      if (nn === q) score = Math.max(score, 95);
      else if (nn.startsWith(q)) score = Math.max(score, 75);
      else if (nn.includes(q)) score = Math.max(score, 55);
    }
    if (score)
      scored.push({
        r: {
          id: `district:${d.id}`,
          label: d.name,
          sublabel: `${d.nameEn} · District`,
          kind: 'district',
          position: d.center,
        },
        score,
      });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.r);
}

// ---------------------------------------------------------------- streets (lazy index from the PBF pipeline)

interface StreetEntry {
  n: string; // name
  e?: string; // name:en
  c: string; // class
  p: [number, number];
  l: number; // length m
}

let streetIndex: StreetEntry[] | null = null;
let streetIndexPromise: Promise<StreetEntry[]> | null = null;

/** Loads public/geojson/streets-index.json once (~0.8 MB); resolves to [] when it does not exist. */
export function loadStreetIndex(url: string): Promise<StreetEntry[]> {
  if (streetIndex) return Promise.resolve(streetIndex);
  if (!streetIndexPromise) {
    streetIndexPromise = fetch(url)
      .then(async (r) => (r.ok ? ((await r.json()) as StreetEntry[]) : []))
      .catch(() => [])
      .then((list) => (streetIndex = list));
  }
  return streetIndexPromise;
}

export function searchStreets(query: string, limit = 6): SearchResult[] {
  if (!streetIndex) return [];
  const q = norm(query);
  if (q.length < 2) return [];
  const out: SearchResult[] = [];
  for (const s of streetIndex) {
    const zh = norm(s.n);
    const en = s.e ? norm(s.e) : '';
    if (zh.includes(q) || (en && en.includes(q))) {
      out.push({
        id: `street:${s.n}`,
        label: s.n,
        sublabel: [s.e, s.c, `${(s.l / 1000).toFixed(1)} km`].filter(Boolean).join(' · '),
        kind: 'street',
        position: { longitude: s.p[0], latitude: s.p[1] },
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}
