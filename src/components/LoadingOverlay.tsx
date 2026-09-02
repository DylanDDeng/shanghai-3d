import { useAppStore } from '../stores/useAppStore';

export function LoadingOverlay() {
  const ready = useAppStore((s) => s.ready);
  const msg = useAppStore((s) => s.loadingMessage);
  return (
    <div className={`loading ${ready ? 'done' : ''}`} aria-hidden={ready}>
      <div className="title">
        Shanghai <span>3D</span>
      </div>
      <div className="bar">
        <i />
      </div>
      <div className="msg">{msg ?? 'Ready'}</div>
    </div>
  );
}
