/**
 * Minimal GeoTIFF height sampler for CNBH-10m tiles (projected in UTM, 10 m pixels, height in metres).
 * Reads the raster in 2048-px blocks on demand and caches them, so sampling millions of points stays fast
 * without loading a 400 MB tile into memory at once.
 */
import { fromFile, type GeoTIFF, type GeoTIFFImage } from 'geotiff';

// ---------------------------------------------------------------- WGS84 → UTM (Transverse Mercator, Krüger series)
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const N_ = F / (2 - F);
const AA = (A / (1 + N_)) * (1 + N_ ** 2 / 4 + N_ ** 4 / 64);
const ALPHA = [
  N_ / 2 - (2 / 3) * N_ ** 2 + (5 / 16) * N_ ** 3,
  (13 / 48) * N_ ** 2 - (3 / 5) * N_ ** 3,
  (61 / 240) * N_ ** 3,
];

export function wgs84ToUtm(lon: number, lat: number, zone: number): [number, number] {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180 - lon0;
  const e = Math.sqrt(E2);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  for (let j = 1; j <= 3; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [K0 * AA * x + 500000, K0 * AA * y];
}

// ---------------------------------------------------------------- block-cached sampler

const BLOCK = 2048;

export class HeightRaster {
  private tiff!: GeoTIFF;
  private img!: GeoTIFFImage;
  private origin!: [number, number];
  private res!: [number, number];
  private width = 0;
  private height = 0;
  private blocks = new Map<string, Promise<ArrayLike<number>>>();
  readonly zone: number;
  bbox!: [number, number, number, number]; // projected

  constructor(
    readonly file: string,
    zone: number,
  ) {
    this.zone = zone;
  }

  async open(): Promise<this> {
    this.tiff = await fromFile(this.file);
    this.img = await this.tiff.getImage();
    const [ox, oy] = this.img.getOrigin();
    const [rx, ry] = this.img.getResolution();
    this.origin = [ox, oy];
    this.res = [rx, ry];
    this.width = this.img.getWidth();
    this.height = this.img.getHeight();
    this.bbox = this.img.getBoundingBox() as [number, number, number, number];
    return this;
  }

  private block(bx: number, by: number): Promise<ArrayLike<number>> {
    const key = `${bx}_${by}`;
    let p = this.blocks.get(key);
    if (!p) {
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      const x1 = Math.min(this.width, x0 + BLOCK);
      const y1 = Math.min(this.height, y0 + BLOCK);
      p = this.img
        .readRasters({ window: [x0, y0, x1, y1] })
        .then((r) => (r as unknown as ArrayLike<number>[])[0]);
      this.blocks.set(key, p);
    }
    return p;
  }

  /** Height (m) at lon/lat, or null when outside / nodata (<= 0). */
  async sample(lon: number, lat: number): Promise<number | null> {
    const [x, y] = wgs84ToUtm(lon, lat, this.zone);
    const px = Math.floor((x - this.origin[0]) / this.res[0]);
    const py = Math.floor((y - this.origin[1]) / this.res[1]);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null;
    const bx = Math.floor(px / BLOCK);
    const by = Math.floor(py / BLOCK);
    const data = await this.block(bx, by);
    const bw = Math.min(this.width, (bx + 1) * BLOCK) - bx * BLOCK;
    const v = data[(py - by * BLOCK) * bw + (px - bx * BLOCK)];
    return v > 0 ? v : null;
  }

  contains(lon: number, lat: number): boolean {
    const [x, y] = wgs84ToUtm(lon, lat, this.zone);
    return x >= this.bbox[0] && x <= this.bbox[2] && y >= this.bbox[1] && y <= this.bbox[3];
  }
}

/** Opens every CNBH tile in a directory; samples from whichever tile contains the point. */
export class HeightRasterSet {
  private rasters: HeightRaster[] = [];
  static async open(files: string[], zone = 51): Promise<HeightRasterSet> {
    const set = new HeightRasterSet();
    for (const f of files) set.rasters.push(await new HeightRaster(f, zone).open());
    return set;
  }
  get size(): number {
    return this.rasters.length;
  }
  async sample(lon: number, lat: number): Promise<number | null> {
    for (const r of this.rasters) if (r.contains(lon, lat)) return r.sample(lon, lat);
    return null;
  }
}
