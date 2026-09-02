# Performance

## Targets

- 60 fps on a recent MacBook (integrated GPU) in the inner-city view; ≥ 30 fps at street level in Lujiazui.
- First interactive < 5 s on a normal connection: the initial payload is the app bundle (≈ 1.3 MB gzip, Cesium
  dominates) plus ~1 MB of GeoJSON; building tiles stream afterwards.
- No whole-city geometry in memory at once.

## What keeps it fast

| Technique                                                                                                        | Where                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 3D Tiles LOD with `ADD` refinement — tall buildings city-wide, mid-rise per 6 km, everything per 1.2 km          | pipeline + `BuildingsLayer`    |
| `maximumScreenSpaceError 12`, dynamic SSE, request culling while moving, 384 MB tile cache                       | `BuildingsLayer`               |
| One draw call per tile: one primitive, one material, vertex colours, no textures                                 | `scripts/lib/gltf.ts`          |
| GPU-evaluated styling (`Cesium3DTileStyle`), no per-feature JS                                                   | `BuildingsLayer.restyle`       |
| Batched primitives for roads (3 buckets), water, parks, boundary; entities only for 16 districts                 | layers                         |
| Distance-based visibility: secondary roads < 18 km, primary < 60 km, district fill > 6 km, imagery fades < 25 km | `onCameraChange`               |
| Camera events throttled to 10 Hz; hover picks throttled to one per frame                                         | `ShanghaiScene`, `Interaction` |
| Resolution scale capped at 1.5× DPR; FXAA instead of heavy MSAA                                                  | `viewer.ts`                    |
| Three.js overlay renders only when an effect is active                                                           | `ThreeOverlay`                 |

## Monitoring

The bottom-left HUD shows FPS / frame time / tiles loaded (+pending) / JS heap (Chrome) / camera. Programmatic
access: `window.__shanghaiStore.getState().perf` (dev) and `window.Shanghai.layers.get('buildings').primary.statistics`.

## Known costs & next optimisations

- **Tile bytes** (138 MB for 88 k buildings, ~1.5 KB/building) come from flat-shaded walls (4 verts/quad) and
  float colours. Next steps: `KHR_mesh_quantization` (int16 positions, oct-encoded normals), uint8 colours,
  uint16 feature IDs → ~3× smaller; then Draco/Meshopt. Also gzip/brotli on the CDN.
- **L1 tiles up to 4 MB** (dense Puxi cells); split L1 at 0.03° if load spikes are visible.
- Water uses Cesium's normal-mapped material on ~900 polygons; fine on desktop, consider a single merged
  primitive for the Huangpu corridor at far LOD.
- Headless CI screenshots run on SwiftShader (≈ 5 fps) — not representative of real GPUs.
