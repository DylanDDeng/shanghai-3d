import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShanghaiScene } from '../scene/ShanghaiScene';
import { useAppStore } from '../stores/useAppStore';
import type { SearchResult } from '../types';

const SUGGESTIONS = [
  '上海中心',
  '东方明珠',
  '外滩',
  '陆家嘴',
  '南京路',
  '静安寺',
  '徐家汇',
  '淮海中路',
  'Pudong',
];

export function SearchPanel({ scene }: { scene: ShanghaiScene }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setPanel = useAppStore((s) => s.setPanel);
  const results = useMemo(() => (q ? scene.search(q) : []), [q, scene]);

  useEffect(() => inputRef.current?.focus(), []);

  const go = (r: SearchResult) => {
    setPanel('none');
    scene.flyToSearchResult(r).catch(console.error);
  };

  return (
    <div className="panel glass">
      <h3>Search</h3>
      <input
        ref={inputRef}
        type="text"
        placeholder="Landmark, street, district, metro station…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) go(results[active]);
          else if (e.key === 'Escape') setPanel('none');
        }}
      />
      {results.length > 0 ? (
        <ul className="results">
          {results.map((r, i) => (
            <li
              key={r.id}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="label">{r.label}</span>
                <span className="kind">{r.kind}</span>
              </span>
              {r.sublabel && <span className="sub">{r.sublabel}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="hint">
          {q ? 'No results.' : 'Try: '}
          {!q &&
            SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="btn"
                style={{ height: 26, padding: '0 8px', fontSize: 12 }}
                onClick={() => setQ(s)}
              >
                {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
