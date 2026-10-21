import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastData } from '../lib/toast';

export function ToastHost() {
  const [t, setT] = useState<ToastData | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => subscribeToasts((next) => {
    setLeaving(false);
    setT(next);
  }), []);

  useEffect(() => {
    if (!t) return;
    const hide = setTimeout(() => setLeaving(true), t.duration);
    return () => clearTimeout(hide);
  }, [t]);

  return (
    <div className="toast-host" aria-live="polite" role="status">
      {t && (
        <div key={t.id} className={`toast ${leaving ? 'out' : ''}`} onAnimationEnd={() => leaving && setT(null)}>
          <span className="grow">{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setLeaving(true);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
