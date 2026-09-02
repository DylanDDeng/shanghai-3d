import { ImageryLayer, UrlTemplateImageryProvider, Viewer, IonImageryProvider, Credit } from 'cesium';
import { config, type ImageryMode } from '../config';
import type { TimeOfDay } from '../types';

export interface ImageryChoice {
  layer: ImageryLayer | null;
  /** Optional second layer swapped in at night (e.g. NASA Black Marble city lights). */
  nightLayer: ImageryLayer | null;
  attribution: string;
}

const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
const GIBS_ATTRIBUTION = 'Imagery: NASA GIBS (Blue Marble / Black Marble, public domain)';

/** NASA GIBS WMTS in Web Mercator — keyless, public domain, max native level 8 (~600 m/px). */
function gibs(layer: string, maximumLevel = 8): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level${maximumLevel}/{z}/{y}/{x}.jpg`,
    maximumLevel,
    credit: new Credit(GIBS_ATTRIBUTION),
  });
}

export async function createImagery(
  viewer: Viewer,
  mode: ImageryMode = config.imagery,
): Promise<ImageryChoice> {
  let provider: UrlTemplateImageryProvider | IonImageryProvider | null = null;
  let nightLayer: ImageryLayer | null = null;
  let attribution = '';

  switch (mode) {
    case 'gibs': {
      provider = gibs('BlueMarble_ShadedRelief_Bathymetry');
      attribution = GIBS_ATTRIBUTION;
      nightLayer = viewer.imageryLayers.addImageryProvider(gibs('VIIRS_CityLights_2012'));
      nightLayer.show = false;
      break;
    }
    case 'carto-dark':
    case 'carto-light': {
      if (!config.cartoApiKey) {
        console.warn(
          '[imagery] CARTO basemaps now require an API key (VITE_CARTO_API_KEY); falling back to gibs',
        );
        return createImagery(viewer, 'gibs');
      }
      const style = mode === 'carto-dark' ? 'dark_nolabels' : 'light_nolabels';
      provider = new UrlTemplateImageryProvider({
        url: `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(config.cartoApiKey)}`,
        subdomains: ['a', 'b', 'c', 'd'],
        customTags: { r: () => (window.devicePixelRatio > 1.5 ? '@2x' : '') },
        maximumLevel: 18,
        credit: new Credit(CARTO_ATTRIBUTION),
      });
      attribution = CARTO_ATTRIBUTION;
      break;
    }
    case 'osm': {
      provider = new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: new Credit('© OpenStreetMap contributors'),
      });
      attribution = '© OpenStreetMap contributors';
      break;
    }
    case 'custom': {
      if (!config.imageryUrl) {
        console.warn('[imagery] custom mode needs VITE_IMAGERY_URL; falling back to gibs');
        return createImagery(viewer, 'gibs');
      }
      provider = new UrlTemplateImageryProvider({
        url: config.imageryUrl,
        maximumLevel: 19,
        credit: new Credit(config.imageryAttribution ?? ''),
      });
      attribution = config.imageryAttribution ?? '';
      break;
    }
    case 'ion-bing': {
      if (!config.ionToken) {
        console.warn('[imagery] ion-bing requested but no VITE_CESIUM_ION_TOKEN; falling back to gibs');
        return createImagery(viewer, 'gibs');
      }
      provider = await IonImageryProvider.fromAssetId(2); // Bing Maps Aerial
      attribution = '© Microsoft Bing Maps via Cesium ion';
      break;
    }
    case 'none':
      return { layer: null, nightLayer: null, attribution: '' };
  }

  const layer = viewer.imageryLayers.addImageryProvider(provider, 0);
  if (nightLayer) viewer.imageryLayers.raiseToTop(nightLayer);
  return { layer, nightLayer, attribution };
}

/** Per-time-of-day tuning of the imagery layers. */
export function tuneImagery(choice: ImageryChoice, time: TimeOfDay): void {
  const { layer, nightLayer } = choice;
  if (layer) {
    layer.brightness = time === 'night' ? 0.35 : time === 'sunset' ? 0.75 : 0.85;
    layer.saturation = time === 'night' ? 0.4 : time === 'sunset' ? 0.9 : 0.8;
    layer.contrast = 1.05;
  }
  if (nightLayer) {
    nightLayer.show = time !== 'day';
    nightLayer.alpha = time === 'night' ? 0.85 : 0.35;
  }
}
