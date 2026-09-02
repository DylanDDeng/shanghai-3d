// Copies Cesium's static runtime assets (Workers, Assets, ThirdParty, Widgets) into public/cesium
// so the app can set window.CESIUM_BASE_URL = '/cesium/'. Runs before dev/build.
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
const src = path.resolve('node_modules/cesium/Build/Cesium');
const dst = path.resolve('public/cesium');
await mkdir(dst, { recursive: true });
for (const dir of ['Workers', 'Assets', 'ThirdParty', 'Widgets']) {
  try {
    await stat(path.join(dst, dir));
  } catch {
    await cp(path.join(src, dir), path.join(dst, dir), { recursive: true });
    console.log(`copied cesium/${dir}`);
  }
}
