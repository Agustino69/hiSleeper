import { useEffect, useState } from 'react';
import type { FocusConfig, FocusWindow } from '../lib/focus';
import { activeWindowNow, focusSupported, loadFocusConfig, syncFocus } from '../lib/focusBridge';
import { fmtClock } from '../lib/format';
import { FocusSettings } from '../screens/FocusSettings';

/** Estado de «Sin pantallas en la cama» en la pantalla de la noche. */
export function FocusCard({ onMorningUnlock }: { onMorningUnlock: () => void }) {
  const [cfg, setCfg] = useState<FocusConfig | null>(null);
  const [active, setActive] = useState<FocusWindow | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => {
    void loadFocusConfig().then(setCfg);
    void activeWindowNow().then(setActive);
  };

  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!cfg) return null;
  const on = focusSupported && cfg.enabled && cfg.packages.length > 0;

  return (
    <>
      {active?.kind === 'morning' && (
        <div className="card banner">
          <p>☀️ Tus apps siguen bloqueadas hasta que te levantes.</p>
          <button className="primary" onClick={onMorningUnlock}>
            {cfg.challenge === 'steps' ? `🚶 Caminar ${cfg.steps} pasos` : '✍️ Anotar mi sueño'}
          </button>
        </div>
      )}
      <section className="card">
        <div className="row">
          <h3 className="grow">📵 Sin pantallas en la cama</h3>
          <button className="small" onClick={() => setOpen(true)}>
            {on ? 'Ajustar' : 'Configurar'}
          </button>
        </div>
        <p className="muted small">
          {!focusSupported
            ? 'Bloquea Instagram, TikTok y compañía al acostarte y al despertar (app de Android).'
            : on
              ? `${cfg.packages.length} apps bloqueadas de ${cfg.bedtime} (−${cfg.windDownMin} min) a ${cfg.wakeTime}${
                  cfg.morningLock ? ', y por la mañana hasta que te levantes' : ''
                }.${active?.kind === 'night' ? ` Activo hasta las ${fmtClock(new Date(active.end))}.` : ''}`
              : 'Evita el scroll infinito: bloquea las apps que elijas a la hora de dormir y hasta que te levantes.'}
        </p>
      </section>
      {open && (
        <FocusSettings
          onClose={() => {
            setOpen(false);
            void syncFocus().then(refresh);
          }}
        />
      )}
    </>
  );
}
