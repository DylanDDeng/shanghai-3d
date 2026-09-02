import { Color } from 'cesium';
import type { TimeOfDay } from '../types';

/** Shared color palette per time of day so all layers stay visually coherent. */
export const PALETTE = {
  day: {
    boundary: Color.fromCssColorString('#8fd3ff').withAlpha(0.9),
    district: Color.fromCssColorString('#7fb7ff').withAlpha(0.35),
    districtFill: Color.fromCssColorString('#7fb7ff').withAlpha(0.03),
    districtHover: Color.fromCssColorString('#ffd166').withAlpha(0.25),
    districtHighlight: Color.fromCssColorString('#ff9f43').withAlpha(0.35),
    water: Color.fromCssColorString('#1a4d7a'),
    waterBlend: Color.fromCssColorString('#2f7fb8'),
    roadMotorway: Color.fromCssColorString('#f2b866').withAlpha(0.95),
    roadPrimary: Color.fromCssColorString('#e6e0c8').withAlpha(0.85),
    roadSecondary: Color.fromCssColorString('#c9c4b2').withAlpha(0.6),
    metroStation: Color.fromCssColorString('#ffffff'),
    park: Color.fromCssColorString('#3f8f4a').withAlpha(0.35),
  },
  sunset: {
    boundary: Color.fromCssColorString('#ffb27a').withAlpha(0.9),
    district: Color.fromCssColorString('#ffb27a').withAlpha(0.35),
    districtFill: Color.fromCssColorString('#ffb27a').withAlpha(0.03),
    districtHover: Color.fromCssColorString('#ffd166').withAlpha(0.25),
    districtHighlight: Color.fromCssColorString('#ff9f43').withAlpha(0.35),
    water: Color.fromCssColorString('#2b3a5c'),
    waterBlend: Color.fromCssColorString('#d9865a'),
    roadMotorway: Color.fromCssColorString('#ffc47a').withAlpha(0.95),
    roadPrimary: Color.fromCssColorString('#ffe2b8').withAlpha(0.85),
    roadSecondary: Color.fromCssColorString('#e0c9a8').withAlpha(0.55),
    metroStation: Color.fromCssColorString('#ffffff'),
    park: Color.fromCssColorString('#4d7a3f').withAlpha(0.35),
  },
  night: {
    boundary: Color.fromCssColorString('#4fc3f7').withAlpha(0.8),
    district: Color.fromCssColorString('#4fc3f7').withAlpha(0.3),
    districtFill: Color.fromCssColorString('#4fc3f7').withAlpha(0.02),
    districtHover: Color.fromCssColorString('#ffd166').withAlpha(0.2),
    districtHighlight: Color.fromCssColorString('#ff9f43').withAlpha(0.3),
    water: Color.fromCssColorString('#06111f'),
    waterBlend: Color.fromCssColorString('#1c3f66'),
    roadMotorway: Color.fromCssColorString('#ffb347').withAlpha(1),
    roadPrimary: Color.fromCssColorString('#ffd88a').withAlpha(0.9),
    roadSecondary: Color.fromCssColorString('#f5c77a').withAlpha(0.5),
    metroStation: Color.fromCssColorString('#ffffff'),
    park: Color.fromCssColorString('#1e4d2a').withAlpha(0.4),
  },
} satisfies Record<TimeOfDay, Record<string, Color>>;

export type PaletteKey = keyof (typeof PALETTE)['day'];
export const paletteColor = (time: TimeOfDay, key: PaletteKey): Color => PALETTE[time][key];
