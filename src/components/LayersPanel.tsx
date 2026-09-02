import type { ShanghaiScene } from '../scene/ShanghaiScene';
import { useAppStore } from '../stores/useAppStore';
import type { LayerId } from '../types';

const ORDER: LayerId[] = [
  'buildings',
  'landmarks',
  'water',
  'roads',
  'districts',
  'metro',
  'boundary',
  'imagery',
  'terrain',
  'parks',
  'poi',
  'traffic',
];

export function LayersPanel({ scene }: { scene: ShanghaiScene }) {
  const layers = useAppStore((s) => s.layers);
  const patch = useAppStore((s) => s.patchLayer);
  const registered = new Set(scene.listLayers());

  return (
    <div className="panel glass">
      <h3>Layers</h3>
      {ORDER.map((id) => {
        const l = layers[id];
        const implemented = registered.has(id);
        const unavailable = !implemented || !l.available;
        return (
          <div key={id} className={`layer-row ${unavailable ? 'unavailable' : ''}`}>
            <button
              className={`switch ${l.visible && !unavailable ? 'on' : ''}`}
              disabled={unavailable}
              aria-label={`toggle ${l.label}`}
              onClick={() => (l.visible ? scene.hideLayer(id) : scene.showLayer(id))}
            />
            <div>
              <div className="name">{l.label}</div>
              <div className={`status ${l.error ? 'err' : ''}`}>
                {!implemented ? 'planned' : l.loading ? 'loading…' : l.error ? l.error.slice(0, 60) : ''}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={l.opacity}
              disabled={unavailable}
              onChange={(e) => {
                const o = Number(e.target.value);
                patch(id, { opacity: o });
                scene.setLayerOpacity(id, o);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
