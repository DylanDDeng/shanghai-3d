import { Cartesian2, ScreenSpaceEventHandler, ScreenSpaceEventType, Viewer, defined } from 'cesium';
import type { LayerManager } from '../layers/LayerManager';
import type { BuildingsLayer } from '../layers/BuildingsLayer';
import type { LandmarksLayer } from '../layers/LandmarksLayer';
import type { DistrictsLayer } from '../layers/DistrictsLayer';
import type { MetroLayer } from '../layers/MetroLayer';
import type { Selection } from '../types';
import { cartesianToWgs84 } from '../geo/coordinates';
import { DISTRICTS } from '../geo/shanghai';

export interface InteractionCallbacks {
  onSelect: (s: Selection | null) => void;
  onHoverDistrict: (id: string | null) => void;
}

/** Mouse picking → typed selections. Throttles hover picks to keep 60 fps. */
export class Interaction {
  private handler: ScreenSpaceEventHandler;
  private hoverPending = false;
  private lastHover = new Cartesian2();

  constructor(
    private readonly viewer: Viewer,
    private readonly layers: LayerManager,
    private readonly cb: InteractionCallbacks,
  ) {
    this.handler = new ScreenSpaceEventHandler(viewer.canvas);
    this.handler.setInputAction(
      (e: ScreenSpaceEventHandler.PositionedEvent) => this.click(e.position),
      ScreenSpaceEventType.LEFT_CLICK,
    );
    this.handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
      Cartesian2.clone(e.endPosition, this.lastHover);
      if (!this.hoverPending) {
        this.hoverPending = true;
        requestAnimationFrame(() => {
          this.hoverPending = false;
          this.hover(this.lastHover);
        });
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  private pick(pos: Cartesian2): Selection | null {
    const scene = this.viewer.scene;
    const picked = scene.pick(pos);
    if (!defined(picked)) return null;
    const landmarks = this.layers.get<LandmarksLayer>('landmarks');
    const buildings = this.layers.get<BuildingsLayer>('buildings');
    const metro = this.layers.get<MetroLayer>('metro');
    const districts = this.layers.get<DistrictsLayer>('districts');

    const lm = landmarks?.selectionFromPick(picked);
    if (lm) return lm;
    const st = metro?.stationFromPick(picked);
    if (st) return st;
    if (buildings) {
      const world = scene.pickPosition(pos);
      const b = buildings.selectionFromPick(picked, world ? cartesianToWgs84(world) : undefined);
      if (b) {
        if (!b.district && b.position)
          b.district = this.districtAt(b.position.longitude, b.position.latitude);
        return b;
      }
    }
    const did = districts?.districtIdForEntity((picked as { id?: unknown }).id);
    if (did) {
      const d = DISTRICTS.find((x) => x.id === did);
      return { kind: 'district', id: did, name: d?.name ?? did, nameEn: d?.nameEn ?? did };
    }
    return null;
  }

  /** Cheap nearest-center district lookup (polygons are also available via DistrictsLayer.hierarchy). */
  private districtAt(lon: number, lat: number): string | undefined {
    let best: string | undefined;
    let bestD = Infinity;
    for (const d of DISTRICTS) {
      const dd = (d.center.longitude - lon) ** 2 + (d.center.latitude - lat) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d.name;
      }
    }
    return best;
  }

  private click(pos: Cartesian2) {
    this.cb.onSelect(this.pick(pos));
  }

  private hover(pos: Cartesian2) {
    const districts = this.layers.get<DistrictsLayer>('districts');
    if (!districts || !this.layers.isVisible('districts')) return;
    // Only pick districts when far enough away that their fill is shown.
    const picked = this.viewer.scene.pick(pos);
    const id = defined(picked) ? districts.districtIdForEntity((picked as { id?: unknown }).id) : null;
    districts.setHovered(id);
    this.cb.onHoverDistrict(id);
    this.viewer.canvas.style.cursor = defined(picked) ? 'pointer' : 'default';
  }

  dispose(): void {
    this.handler.destroy();
  }
}
