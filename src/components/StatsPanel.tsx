import { useAppStore } from '../stores/useAppStore';

function fmtAlt(m: number): string {
  return m >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`;
}

export function StatsPanel() {
  const perf = useAppStore((s) => s.perf);
  const cam = useAppStore((s) => s.camera);
  const fpsClass = perf.fps >= 50 ? 'good' : perf.fps >= 30 ? 'warn' : 'bad';
  return (
    <div className="hud stats glass">
      <span className="k">FPS</span>
      <span className={`v ${fpsClass}`}>{perf.fps.toFixed(0)}</span>
      <span className="k">Frame</span>
      <span className="v">{perf.frameMs.toFixed(1)} ms</span>
      <span className="k">Tiles</span>
      <span className="v">
        {perf.tilesLoaded}
        {perf.tilesLoading ? ` +${perf.tilesLoading}` : ''}
      </span>
      {perf.jsHeapMB !== undefined && (
        <>
          <span className="k">Heap</span>
          <span className="v">{perf.jsHeapMB.toFixed(0)} MB</span>
        </>
      )}
      <span className="k">Alt</span>
      <span className="v">{fmtAlt(cam.height)}</span>
      <span className="k">Lon</span>
      <span className="v">{cam.longitude.toFixed(5)}</span>
      <span className="k">Lat</span>
      <span className="v">{cam.latitude.toFixed(5)}</span>
      <span className="k">Hdg/Pitch</span>
      <span className="v">
        {((cam.heading + 360) % 360).toFixed(0)}° / {cam.pitch.toFixed(0)}°
      </span>
    </div>
  );
}
