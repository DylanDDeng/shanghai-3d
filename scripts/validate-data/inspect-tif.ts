/** Prints GeoTIFF metadata (extent, size, dtype, nodata, compression) and samples a few pixels. */
import { fromFile } from 'geotiff';
const file = process.argv[2];
const tiff = await fromFile(file);
const img = await tiff.getImage();
const [ox, oy] = img.getOrigin();
const [rx, ry] = img.getResolution();
const bbox = img.getBoundingBox();
const fd = img.getFileDirectory();
console.log({
  file,
  width: img.getWidth(),
  height: img.getHeight(),
  origin: [ox, oy],
  res: [rx, ry],
  bbox,
  samplesPerPixel: img.getSamplesPerPixel(),
  bitsPerSample: fd.BitsPerSample,
  sampleFormat: fd.SampleFormat,
  compression: fd.Compression,
  tiled: img.isTiled,
  tileW: img.getTileWidth(),
  tileH: img.getTileHeight(),
  nodata: img.getGDALNoData(),
  geoKeys: img.getGeoKeys() && {
    model: img.getGeoKeys().GTModelTypeGeoKey,
    cs: img.getGeoKeys().GeographicTypeGeoKey,
  },
});
// sample around Lujiazui (121.50, 31.24)
const px = Math.floor((121.5013 - ox) / rx),
  py = Math.floor((31.2356 - oy) / ry);
const win = await img.readRasters({ window: [px - 3, py - 3, px + 4, py + 4] });
console.log('Shanghai Tower area 7x7:', Array.from(win[0] as ArrayLike<number>).join(' '));
