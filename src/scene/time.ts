import { Cartesian3, Color, DirectionalLight, JulianDate, SunLight, Viewer } from 'cesium';
import type { TimeOfDay } from '../types';

/**
 * Day / sunset / night presets. Cesium's sun position is driven by the clock, so we pin the clock to a
 * representative Shanghai local time (UTC+8) and stop it. Night additionally swaps the sun for a dim
 * directional light so 3D Tiles do not go pitch-black.
 */
const PRESETS: Record<
  TimeOfDay,
  { iso: string; lightIntensity: number; fogDensity: number; atmosphereBrightness: number }
> = {
  day: { iso: '2026-06-21T04:00:00Z', lightIntensity: 2.0, fogDensity: 0.0004, atmosphereBrightness: 0 },
  sunset: {
    iso: '2026-06-21T10:40:00Z',
    lightIntensity: 1.4,
    fogDensity: 0.0006,
    atmosphereBrightness: -0.1,
  },
  night: {
    iso: '2026-06-21T14:30:00Z',
    lightIntensity: 0.55,
    fogDensity: 0.0003,
    atmosphereBrightness: -0.6,
  },
};

export class TimeController {
  private current: TimeOfDay = 'day';
  private sun = new SunLight();

  constructor(private readonly viewer: Viewer) {
    viewer.clock.shouldAnimate = false;
    viewer.clock.multiplier = 0;
  }

  get time(): TimeOfDay {
    return this.current;
  }

  set(time: TimeOfDay): void {
    const preset = PRESETS[time];
    const { scene, clock } = this.viewer;
    this.current = time;
    clock.currentTime = JulianDate.fromIso8601(preset.iso);
    scene.fog.density = preset.fogDensity;
    if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = preset.atmosphereBrightness;
    scene.globe.enableLighting = true;
    if (time === 'night') {
      // Moon-ish light from the north-east so facades keep some shading.
      scene.light = new DirectionalLight({
        direction: Cartesian3.normalize(new Cartesian3(-0.3, -0.5, -0.8), new Cartesian3()),
        color: Color.fromCssColorString('#9fb4d8'),
        intensity: preset.lightIntensity,
      });
      scene.globe.baseColor = Color.fromCssColorString('#05080d');
      scene.backgroundColor = Color.fromCssColorString('#02040a');
    } else {
      this.sun.intensity = preset.lightIntensity;
      scene.light = this.sun;
      scene.globe.baseColor = Color.fromCssColorString(time === 'sunset' ? '#141017' : '#0b1118');
      scene.backgroundColor = Color.fromCssColorString('#04070c');
    }
    scene.requestRender();
  }
}
