/** Samples CNBH-10m at a few known Shanghai points to verify the CRS mapping. */
import { HeightRasterSet, wgs84ToUtm } from '../lib/raster.js';
import { fromFile } from 'geotiff';
const tiff = await fromFile('data/raw/cnbh/CNBH10m_X121Y31.tif');
const img = await tiff.getImage();
console.log('geokeys:', JSON.stringify(img.getGeoKeys()));
console.log(
  'UTM51 of Shanghai Tower:',
  wgs84ToUtm(121.5013, 31.2356, 51).map((v) => v.toFixed(0)),
);
const set = await HeightRasterSet.open([
  'data/raw/cnbh/CNBH10m_X121Y31.tif',
  'data/raw/cnbh/CNBH10m_X123Y31.tif',
]);
const pts: Array<[string, number, number]> = [
  ['Shanghai Tower', 121.5013, 31.2356],
  ['Jin Mao', 121.50141, 31.23726],
  ['Bund old town lilong', 121.4805, 31.2265],
  ['Songjiang new town', 121.2285, 31.03],
  ['Chongming farmland', 121.5, 31.62],
  ['Huangpu river (water)', 121.495, 31.235],
  ['Pudong airport', 121.8, 31.15],
  ['Xujiahui', 121.43438, 31.19554],
];
for (const [n, lon, lat] of pts) console.log(n.padEnd(24), await set.sample(lon, lat));
