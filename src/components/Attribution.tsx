import { config } from '../config';

const imageryCredit: Record<string, string> = {
  gibs: 'Imagery: NASA GIBS (public domain)',
  custom: import.meta.env.VITE_IMAGERY_ATTRIBUTION ?? '',
  'carto-dark': '© OpenStreetMap contributors © CARTO',
  'carto-light': '© OpenStreetMap contributors © CARTO',
  osm: '© OpenStreetMap contributors',
  'ion-bing': '© Microsoft Bing Maps',
  none: '',
};

export function Attribution() {
  const parts = [
    'Map data © OpenStreetMap contributors · Overture Maps (ODbL) · Buildings © Shi et al. 2023 · Heights CNBH-10m © Wu et al. 2023 (CC BY 4.0)',
    imageryCredit[config.imagery],
    config.terrain === 'ion'
      ? 'Terrain: Cesium World Terrain'
      : config.terrain === 'local'
        ? 'Terrain: Copernicus DEM © ESA'
        : '',
    'CesiumJS',
  ].filter(Boolean);
  return <div className="hud attribution">{parts.join(' · ')}</div>;
}
