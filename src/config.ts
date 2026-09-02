/** Central runtime configuration read from Vite env. Never hardcode tokens elsewhere. */
export type ImageryMode = 'gibs' | 'carto-dark' | 'carto-light' | 'osm' | 'custom' | 'ion-bing' | 'none';
export type TerrainMode = 'ellipsoid' | 'ion' | 'local';
export type BuildingsMode = 'local' | 'ion' | 'both';

const env = import.meta.env;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const config = {
  ionToken: (env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim() || undefined,
  imagery: pick<ImageryMode>(
    env.VITE_IMAGERY,
    ['gibs', 'carto-dark', 'carto-light', 'osm', 'custom', 'ion-bing', 'none'],
    'gibs',
  ),
  cartoApiKey: (env.VITE_CARTO_API_KEY as string | undefined)?.trim() || undefined,
  imageryUrl: (env.VITE_IMAGERY_URL as string | undefined)?.trim() || undefined,
  imageryAttribution: (env.VITE_IMAGERY_ATTRIBUTION as string | undefined)?.trim() || undefined,
  terrain: pick<TerrainMode>(env.VITE_TERRAIN, ['ellipsoid', 'ion', 'local'], 'ellipsoid'),
  buildings: pick<BuildingsMode>(env.VITE_BUILDINGS, ['local', 'ion', 'both'], 'local'),
  /** Base URL for heavy static data. '' = served from public/ on the same origin.
   *  A page can override it at runtime (single-file build): <script>window.SHANGHAI_DATA_URL = 'https://…'</script> */
  dataBaseUrl: ((globalThis as { SHANGHAI_DATA_URL?: string }).SHANGHAI_DATA_URL ?? (env.VITE_DATA_BASE_URL as string | undefined) ?? '').replace(/\/$/, ''),
} as const;

/** Resolve a data path such as "tiles/buildings/tileset.json" against the configured data base URL. */
export function dataUrl(relative: string): string {
  const clean = relative.replace(/^\//, '');
  return config.dataBaseUrl ? `${config.dataBaseUrl}/${clean}` : `/${clean}`;
}
