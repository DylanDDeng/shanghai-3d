import type { Viewer } from 'cesium';
import type { CameraController } from '../cesium/camera';
import type { LayerId, TimeOfDay } from '../types';

export interface LayerContext {
  viewer: Viewer;
  camera: CameraController;
  /** Called by layers to report loading/error status to the UI. */
  report: (id: LayerId, patch: { loading?: boolean; error?: string; available?: boolean }) => void;
}

/**
 * Every visual layer implements this. Layers own their Cesium primitives/entities/tilesets and nothing else
 * in the app touches those objects directly.
 */
export interface Layer {
  readonly id: LayerId;
  /** Load data & create primitives. Must be idempotent-safe against dispose. */
  init(ctx: LayerContext): Promise<void>;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  /** Adjust colors/lighting for the time of day. */
  applyTime?(time: TimeOfDay): void;
  /** Called on camera change (throttled) for distance-based LOD decisions. */
  onCameraChange?(viewDistance: number): void;
  dispose(): void;
}
