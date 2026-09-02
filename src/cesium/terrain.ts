import { CesiumTerrainProvider, EllipsoidTerrainProvider, Viewer, createWorldTerrainAsync } from 'cesium';
import { config, dataUrl, type TerrainMode } from '../config';

/**
 * Terrain pipeline hook. Shanghai is almost flat (0–5 m), so the default is the WGS84 ellipsoid, but the
 * pipeline (scripts/process-dem) can produce self-hosted quantized-mesh terrain from Copernicus DEM GLO-30.
 */
export async function applyTerrain(viewer: Viewer, mode: TerrainMode = config.terrain): Promise<string> {
  try {
    switch (mode) {
      case 'ion':
        if (!config.ionToken) throw new Error('VITE_CESIUM_ION_TOKEN missing');
        viewer.terrainProvider = await createWorldTerrainAsync({ requestVertexNormals: true });
        return 'Cesium World Terrain';
      case 'local':
        viewer.terrainProvider = await CesiumTerrainProvider.fromUrl(dataUrl('terrain/shanghai'), {
          requestVertexNormals: true,
        });
        return 'Copernicus DEM GLO-30 (self-hosted)';
      case 'ellipsoid':
      default:
        viewer.terrainProvider = new EllipsoidTerrainProvider();
        return 'WGS84 ellipsoid';
    }
  } catch (e) {
    console.warn(`[terrain] ${mode} failed (${(e as Error).message}); using ellipsoid`);
    viewer.terrainProvider = new EllipsoidTerrainProvider();
    return 'WGS84 ellipsoid';
  }
}
