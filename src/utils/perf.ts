import type { Viewer } from 'cesium';

export interface PerfSample {
  fps: number;
  frameMs: number;
  jsHeapMB?: number;
}

/** Lightweight frame-time monitor driven by Cesium's postRender (so it measures real scene frames). */
export class PerfMonitor {
  private frames = 0;
  private acc = 0;
  private last = performance.now();
  private remove: () => void;

  constructor(viewer: Viewer, onSample: (s: PerfSample) => void, intervalMs = 500) {
    const tick = () => {
      const now = performance.now();
      this.acc += now - this.last;
      this.last = now;
      this.frames++;
      if (this.acc >= intervalMs) {
        const frameMs = this.acc / this.frames;
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        onSample({ fps: 1000 / frameMs, frameMs, jsHeapMB: mem ? mem.usedJSHeapSize / 1048576 : undefined });
        this.acc = 0;
        this.frames = 0;
      }
    };
    viewer.scene.postRender.addEventListener(tick);
    this.remove = () => viewer.scene.postRender.removeEventListener(tick);
  }

  dispose(): void {
    this.remove();
  }
}
