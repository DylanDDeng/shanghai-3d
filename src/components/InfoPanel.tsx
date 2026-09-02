import type { ShanghaiScene } from '../scene/ShanghaiScene';
import { useAppStore } from '../stores/useAppStore';

export function InfoPanel({ scene }: { scene: ShanghaiScene }) {
  const sel = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  if (!sel) return null;

  const close = () => setSelection(null);

  return (
    <div className="hud info glass">
      <header>
        <span className="kind">{sel.kind}</span>
        <h2>
          {sel.kind === 'building'
            ? (sel.name ?? 'Building')
            : sel.kind === 'landmark'
              ? sel.name
              : sel.kind === 'district'
                ? sel.name
                : sel.name}
        </h2>
        <button className="btn icon close" onClick={close} aria-label="close">
          ×
        </button>
      </header>

      {sel.kind === 'building' && (
        <dl>
          <dt>Height</dt>
          <dd>
            {sel.height.toFixed(0)} m{' '}
            {sel.heightSource ? (
              <small style={{ color: 'var(--hud-muted)' }}>({sel.heightSource})</small>
            ) : null}
          </dd>
          <dt>Floors</dt>
          <dd>{sel.levels ?? Math.max(1, Math.round(sel.height / 3.2))}</dd>
          <dt>Type</dt>
          <dd>{sel.type ?? 'unknown'}</dd>
          <dt>District</dt>
          <dd>{sel.district ?? '—'}</dd>
          <dt>Source</dt>
          <dd>
            {sel.source && sel.source !== 'osm' ? (
              sel.source
                .replace('overture:doi:10.5281/zenodo.8174931', 'Overture · Shi et al. 2023')
                .replace('overture:', 'Overture · ')
            ) : (
              <a
                href={`https://www.openstreetmap.org/way/${sel.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                OSM {String(sel.id)}
              </a>
            )}
          </dd>
        </dl>
      )}
      {sel.kind === 'landmark' && (
        <>
          <dl>
            <dt>Name</dt>
            <dd>{sel.nameEn}</dd>
            <dt>Height</dt>
            <dd>{sel.height} m</dd>
            <dt>Built</dt>
            <dd>{sel.built ?? '—'}</dd>
          </dl>
          {sel.description && <p>{sel.description}</p>}
          <div className="actions">
            <button className="btn active" onClick={() => scene.flyToLandmark(sel.id)}>
              Fly to
            </button>
          </div>
        </>
      )}
      {sel.kind === 'district' && (
        <>
          <dl>
            <dt>English</dt>
            <dd>{sel.nameEn}</dd>
          </dl>
          <div className="actions">
            <button className="btn active" onClick={() => scene.flyToDistrict(sel.id)}>
              Fly to
            </button>
            <button className="btn" onClick={() => scene.highlightDistrict(sel.id)}>
              Highlight
            </button>
            <button className="btn" onClick={() => scene.highlightDistrict(null)}>
              Clear
            </button>
          </div>
        </>
      )}
      {sel.kind === 'station' && (
        <dl>
          <dt>Lines</dt>
          <dd>{sel.lines.length ? sel.lines.join(', ') : '—'}</dd>
          <dt>Position</dt>
          <dd>
            {sel.position.longitude.toFixed(5)}, {sel.position.latitude.toFixed(5)}
          </dd>
        </dl>
      )}
    </div>
  );
}
