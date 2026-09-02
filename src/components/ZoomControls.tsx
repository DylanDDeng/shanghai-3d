import type { ShanghaiScene } from '../scene/ShanghaiScene';

export function ZoomControls({ scene }: { scene: ShanghaiScene }) {
  return (
    <div className="hud zoom glass">
      <button className="btn icon" title="Zoom in" onClick={() => scene.camera.zoomIn()}>
        +
      </button>
      <button className="btn icon" title="Zoom out" onClick={() => scene.camera.zoomOut()}>
        −
      </button>
      <button
        className="btn icon"
        title="Tilt"
        onClick={() => scene.camera.setPitch(scene.getCamera().pitch < -60 ? -35 : -80)}
      >
        ⤢
      </button>
      <button className="btn icon" title="Face north" onClick={() => scene.camera.resetOrientation()}>
        N
      </button>
    </div>
  );
}
