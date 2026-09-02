import { useState } from 'react';
import type { ShanghaiScene } from '../scene/ShanghaiScene';
import { useAppStore } from '../stores/useAppStore';
import { SearchPanel } from './SearchPanel';
import { LayersPanel } from './LayersPanel';
import { StatsPanel } from './StatsPanel';
import { ZoomControls } from './ZoomControls';
import { InfoPanel } from './InfoPanel';
import { Attribution } from './Attribution';
import type { TimeOfDay, Weather } from '../types';

const TIMES: Array<[TimeOfDay, string]> = [
  ['day', '☀ Day'],
  ['sunset', '🌇 Sunset'],
  ['night', '🌙 Night'],
];
const WEATHERS: Array<[Weather, string]> = [
  ['clear', 'Clear'],
  ['rain', 'Rain'],
  ['snow', 'Snow'],
  ['fog', 'Fog'],
];

export function Hud({ scene }: { scene: ShanghaiScene }) {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const time = useAppStore((s) => s.time);
  const weather = useAppStore((s) => s.weather);
  const [weatherOpen, setWeatherOpen] = useState(false);

  return (
    <>
      <div className="hud brand glass">
        <h1>
          Shanghai <span>3D</span>
        </h1>
        <small>Open-data digital city · CesiumJS</small>
      </div>

      <div className="hud toolbar">
        <div className="glass">
          <button
            className={`btn ${panel === 'search' ? 'active' : ''}`}
            onClick={() => setPanel(panel === 'search' ? 'none' : 'search')}
          >
            🔍 Search
          </button>
          <button
            className={`btn ${panel === 'layers' ? 'active' : ''}`}
            onClick={() => setPanel(panel === 'layers' ? 'none' : 'layers')}
          >
            ▦ Layers
          </button>
        </div>
        <div className="glass">
          <div className="seg">
            {TIMES.map(([t, label]) => (
              <button
                key={t}
                className={`btn ${time === t ? 'active' : ''}`}
                onClick={() => scene.setTime(t)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="glass" style={{ position: 'relative' }}>
          <button
            className={`btn ${weather !== 'clear' ? 'active' : ''}`}
            onClick={() => setWeatherOpen((v) => !v)}
          >
            ☁ {WEATHERS.find(([w]) => w === weather)?.[1]}
          </button>
          {weatherOpen && (
            <div
              className="glass"
              style={{ position: 'absolute', top: 44, right: 0, flexDirection: 'column', minWidth: 120 }}
            >
              {WEATHERS.map(([w, label]) => (
                <button
                  key={w}
                  className={`btn ${weather === w ? 'active' : ''}`}
                  onClick={() => {
                    scene.setWeather(w);
                    setWeatherOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="glass">
          <button className="btn icon" title="Reset view" onClick={() => scene.reset()}>
            ⌂
          </button>
        </div>
      </div>

      {panel === 'search' && <SearchPanel scene={scene} />}
      {panel === 'layers' && <LayersPanel scene={scene} />}

      <StatsPanel />
      <ZoomControls scene={scene} />
      <InfoPanel scene={scene} />
      <Attribution />
    </>
  );
}
