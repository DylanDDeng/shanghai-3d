import type { Viewer } from 'cesium';
import { Color } from 'cesium';
import type { Weather } from '../types';
import { ThreeOverlay } from '../three/ThreeOverlay';
import { Precipitation } from '../three/precipitation';

/** Weather presets: precipitation via the Three.js overlay, fog/haze via Cesium's atmosphere & fog. */
export class WeatherController {
  private current: Weather = 'clear';
  private precipitation: Precipitation | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly overlay: ThreeOverlay,
  ) {}

  get weather(): Weather {
    return this.current;
  }

  set(weather: Weather): void {
    this.current = weather;
    this.precipitation?.dispose();
    this.precipitation = null;
    const { scene } = this.viewer;
    const sky = scene.skyAtmosphere ?? { saturationShift: 0, brightnessShift: 0 };
    scene.fog.enabled = true;
    switch (weather) {
      case 'rain':
        this.precipitation = new Precipitation(this.overlay, 'rain');
        scene.fog.density = 0.0012;
        sky.saturationShift = -0.5;
        sky.brightnessShift = -0.35;
        scene.globe.baseColor = Color.fromCssColorString('#0a0f14');
        break;
      case 'snow':
        this.precipitation = new Precipitation(this.overlay, 'snow');
        scene.fog.density = 0.0009;
        sky.saturationShift = -0.6;
        sky.brightnessShift = -0.1;
        break;
      case 'fog':
        scene.fog.density = 0.0035;
        scene.fog.minimumBrightness = 0.15;
        sky.saturationShift = -0.7;
        sky.brightnessShift = -0.3;
        break;
      case 'clear':
      default:
        scene.fog.density = 0.0004;
        scene.fog.minimumBrightness = 0.03;
        sky.saturationShift = 0;
        break;
    }
    scene.requestRender();
  }

  dispose(): void {
    this.precipitation?.dispose();
  }
}
