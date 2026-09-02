/** Static geographic knowledge about Shanghai: extents, districts, named places. All WGS84 degrees. */
import type { LonLatHeight } from './coordinates';

export const SHANGHAI_CENTER: LonLatHeight = { longitude: 121.4704, latitude: 31.2311 }; // People's Square (WGS84, from OSM)

/** Whole municipality bounding box (degrees). */
export const SHANGHAI_BBOX = { west: 120.85, south: 30.65, east: 122.25, north: 31.9 };

/** Dense urban core (used for camera presets); the building tileset and roads now cover the whole municipality. */
export const INNER_BBOX = { west: 121.32, south: 31.1, east: 121.68, north: 31.36 };

export interface DistrictInfo {
  id: string; // english slug
  name: string; // chinese name (matches OSM `name`)
  nameEn: string;
  center: LonLatHeight;
  /** Suggested camera height (m) when flying to the district. */
  viewHeight: number;
}

export const DISTRICTS: DistrictInfo[] = [
  {
    id: 'pudong',
    name: '浦东新区',
    nameEn: 'Pudong',
    center: { longitude: 121.58, latitude: 31.19 },
    viewHeight: 60000,
  },
  {
    id: 'huangpu',
    name: '黄浦区',
    nameEn: 'Huangpu',
    center: { longitude: 121.4792, latitude: 31.218 },
    viewHeight: 10000,
  },
  {
    id: 'xuhui',
    name: '徐汇区',
    nameEn: 'Xuhui',
    center: { longitude: 121.4359, latitude: 31.1639 },
    viewHeight: 16000,
  },
  {
    id: 'jingan',
    name: '静安区',
    nameEn: "Jing'an",
    center: { longitude: 121.4461, latitude: 31.2727 },
    viewHeight: 14000,
  },
  {
    id: 'changning',
    name: '长宁区',
    nameEn: 'Changning',
    center: { longitude: 121.3764, latitude: 31.2093 },
    viewHeight: 14000,
  },
  {
    id: 'yangpu',
    name: '杨浦区',
    nameEn: 'Yangpu',
    center: { longitude: 121.5248, latitude: 31.3006 },
    viewHeight: 16000,
  },
  {
    id: 'hongkou',
    name: '虹口区',
    nameEn: 'Hongkou',
    center: { longitude: 121.4809, latitude: 31.2786 },
    viewHeight: 11000,
  },
  {
    id: 'putuo',
    name: '普陀区',
    nameEn: 'Putuo',
    center: { longitude: 121.3873, latitude: 31.2598 },
    viewHeight: 15000,
  },
  {
    id: 'minhang',
    name: '闵行区',
    nameEn: 'Minhang',
    center: { longitude: 121.4176, latitude: 31.0908 },
    viewHeight: 40000,
  },
  {
    id: 'baoshan',
    name: '宝山区',
    nameEn: 'Baoshan',
    center: { longitude: 121.4044, latitude: 31.4054 },
    viewHeight: 40000,
  },
  {
    id: 'jiading',
    name: '嘉定区',
    nameEn: 'Jiading',
    center: { longitude: 121.2397, latitude: 31.3602 },
    viewHeight: 45000,
  },
  {
    id: 'songjiang',
    name: '松江区',
    nameEn: 'Songjiang',
    center: { longitude: 121.2159, latitude: 31.0172 },
    viewHeight: 50000,
  },
  {
    id: 'qingpu',
    name: '青浦区',
    nameEn: 'Qingpu',
    center: { longitude: 121.0797, latitude: 31.1252 },
    viewHeight: 55000,
  },
  {
    id: 'fengxian',
    name: '奉贤区',
    nameEn: 'Fengxian',
    center: { longitude: 121.5909, latitude: 30.8516 },
    viewHeight: 55000,
  },
  {
    id: 'jinshan',
    name: '金山区',
    nameEn: 'Jinshan',
    center: { longitude: 121.2731, latitude: 30.807 },
    viewHeight: 55000,
  },
  {
    id: 'chongming',
    name: '崇明区',
    nameEn: 'Chongming',
    center: { longitude: 121.45, latitude: 31.62 },
    viewHeight: 110000,
  },
];

export interface Place {
  id: string;
  name: string; // zh
  nameEn: string;
  aliases?: string[];
  kind: 'landmark' | 'area' | 'street' | 'station' | 'district';
  position: LonLatHeight;
  /** Camera view: distance (m) from target and pitch (deg, negative looks down). */
  view: { range: number; pitch: number; heading?: number };
}

/** Curated search targets (WGS84 resolved from OSM via scripts/validate-data/lookup-places.ts — never GCJ-02). */
export const PLACES: Place[] = [
  {
    id: 'lujiazui',
    name: '陆家嘴',
    nameEn: 'Lujiazui',
    kind: 'area',
    position: { longitude: 121.49613, latitude: 31.24025 },
    view: { range: 2600, pitch: -32, heading: 20 },
  },
  {
    id: 'bund',
    name: '外滩',
    nameEn: 'The Bund',
    aliases: ['Waitan'],
    kind: 'area',
    position: { longitude: 121.4878, latitude: 31.2395 },
    view: { range: 1800, pitch: -28, heading: 60 },
  },
  {
    id: 'shanghai-tower',
    name: '上海中心大厦',
    nameEn: 'Shanghai Tower',
    aliases: ['上海中心'],
    kind: 'landmark',
    position: { longitude: 121.50129, latitude: 31.2356, height: 632 },
    view: { range: 1500, pitch: -25, heading: 210 },
  },
  {
    id: 'oriental-pearl',
    name: '东方明珠',
    nameEn: 'Oriental Pearl Tower',
    aliases: ['东方明珠塔', '东方明珠广播电视塔'],
    kind: 'landmark',
    position: { longitude: 121.49526, latitude: 31.24189, height: 468 },
    view: { range: 1200, pitch: -22, heading: 240 },
  },
  {
    id: 'jin-mao',
    name: '金茂大厦',
    nameEn: 'Jin Mao Tower',
    kind: 'landmark',
    position: { longitude: 121.50141, latitude: 31.23726, height: 421 },
    view: { range: 1200, pitch: -25, heading: 200 },
  },
  {
    id: 'swfc',
    name: '上海环球金融中心',
    nameEn: 'Shanghai World Financial Center',
    aliases: ['环球金融中心', 'SWFC'],
    kind: 'landmark',
    position: { longitude: 121.50301, latitude: 31.23657, height: 492 },
    view: { range: 1300, pitch: -25, heading: 190 },
  },
  {
    id: 'ifc',
    name: '上海国际金融中心',
    nameEn: 'Shanghai IFC',
    aliases: ['国金中心', 'IFC'],
    kind: 'landmark',
    position: { longitude: 121.49776, latitude: 31.2391, height: 260 },
    view: { range: 1000, pitch: -25 },
  },
  {
    id: 'exhibition-center',
    name: '上海展览中心',
    nameEn: 'Shanghai Exhibition Center',
    kind: 'landmark',
    position: { longitude: 121.44804, latitude: 31.22709, height: 106 },
    view: { range: 900, pitch: -30 },
  },
  {
    id: 'nanjing-road',
    name: '南京路',
    nameEn: 'Nanjing Road',
    aliases: ['南京东路', '南京路步行街'],
    kind: 'street',
    position: { longitude: 121.4778, latitude: 31.2375 },
    view: { range: 1500, pitch: -35, heading: 90 },
  },
  {
    id: 'jingan-temple',
    name: '静安寺',
    nameEn: "Jing'an Temple",
    kind: 'landmark',
    position: { longitude: 121.44073, latitude: 31.22541 },
    view: { range: 900, pitch: -35 },
  },
  {
    id: 'xujiahui',
    name: '徐家汇',
    nameEn: 'Xujiahui',
    kind: 'area',
    position: { longitude: 121.43438, latitude: 31.19554 },
    view: { range: 2000, pitch: -35 },
  },
  {
    id: 'peoples-square',
    name: '人民广场',
    nameEn: "People's Square",
    kind: 'area',
    position: { longitude: 121.4704, latitude: 31.23108 },
    view: { range: 1800, pitch: -35 },
  },
  {
    id: 'yuyuan',
    name: '豫园',
    nameEn: 'Yu Garden',
    kind: 'landmark',
    position: { longitude: 121.48775, latitude: 31.22892 },
    view: { range: 900, pitch: -40 },
  },
  {
    id: 'hongqiao',
    name: '虹桥',
    nameEn: 'Hongqiao',
    aliases: ['虹桥枢纽', '虹桥机场'],
    kind: 'area',
    position: { longitude: 121.33422, latitude: 31.19765 },
    view: { range: 6000, pitch: -40 },
  },
  {
    id: 'pudong-airport',
    name: '浦东国际机场',
    nameEn: 'Pudong Airport',
    aliases: ['PVG'],
    kind: 'area',
    position: { longitude: 121.8148, latitude: 31.14266 },
    view: { range: 9000, pitch: -45 },
  },
  {
    id: 'north-bund',
    name: '北外滩',
    nameEn: 'North Bund',
    kind: 'area',
    position: { longitude: 121.4935, latitude: 31.2465 },
    view: { range: 1800, pitch: -30, heading: 150 },
  },
];

export function findPlace(idOrName: string): Place | undefined {
  const q = idOrName.trim().toLowerCase();
  return PLACES.find(
    (p) =>
      p.id === q ||
      p.name === idOrName ||
      p.nameEn.toLowerCase() === q ||
      p.aliases?.some((a) => a.toLowerCase() === q),
  );
}

export function findDistrict(idOrName: string): DistrictInfo | undefined {
  const q = idOrName.trim().toLowerCase().replace(/['\s]/g, '');
  return DISTRICTS.find(
    (d) =>
      d.id === q ||
      d.name === idOrName ||
      d.name.replace(/[区新]/g, '') === idOrName ||
      d.nameEn.toLowerCase().replace(/['\s]/g, '') === q,
  );
}
