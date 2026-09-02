/**
 * Minimal Overpass API client with retries + endpoint rotation.
 * All downloads are cached to data/raw/<name>.osm.json so re-runs are cheap.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const RAW_DIR = path.resolve(process.cwd(), 'data/raw');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OverpassJson {
  elements: unknown[];
  remark?: string;
}

export async function overpass(
  query: string,
  opts: { retries?: number; timeout?: number } = {},
): Promise<OverpassJson> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'shanghai-3d-pipeline/0.1 (+https://github.com/shanghai-3d; open-data city model)',
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(opts.timeout ?? 300_000),
      });
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as OverpassJson;
      if (json.remark && /timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      return json;
    } catch (e) {
      lastErr = e;
      const wait = 5_000 * (attempt + 1);
      console.warn(
        `  overpass attempt ${attempt + 1}/${retries} failed (${endpoint}): ${(e as Error).message}; retry in ${wait / 1000}s`,
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** Run a query unless data/raw/<name>.osm.json already exists. */
export async function cachedOverpass(name: string, query: string): Promise<OverpassJson> {
  await mkdir(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, `${name}.osm.json`);
  try {
    const s = await stat(file);
    if (s.size > 0) {
      console.log(`  [cache] ${name} (${(s.size / 1e6).toFixed(1)} MB)`);
      return JSON.parse(await readFile(file, 'utf8')) as OverpassJson;
    }
  } catch {
    /* not cached */
  }
  console.log(`  [fetch] ${name}`);
  const t0 = Date.now();
  const json = await overpass(query);
  await writeFile(file, JSON.stringify(json));
  console.log(
    `  [saved] ${name}: ${json.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return json;
}
