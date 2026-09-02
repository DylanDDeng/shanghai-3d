import { useRef } from 'react';
import { useShanghai } from './useShanghai';
import { Hud } from '../components/Hud';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { useAppStore } from '../stores/useAppStore';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scene = useShanghai(containerRef);
  const fatal = useAppStore((s) => s.fatalError);

  return (
    <div className="app">
      <div ref={containerRef} className="cesium-container" />
      {scene && <Hud scene={scene} />}
      <LoadingOverlay />
      {fatal && (
        <div className="fatal">
          <div>
            <h2>Shanghai 3D could not start</h2>
            <pre>{fatal}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
