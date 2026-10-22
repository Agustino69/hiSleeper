import { useCallback, useEffect, useState } from 'react';
import { countdown, IDLE_STATE, wakeDetectionFrom, type FocusConfig, type SleepState } from '../lib/focus';
import { cancelSleep, focusSupported, getSleepState, loadFocusConfig, startSleep, syncFocus } from '../lib/focusBridge';
import { fmtClock } from '../lib/format';
import { haptic } from '../lib/haptics';
import { FocusSettings } from '../screens/FocusSettings';
import { Segmented } from './Segmented';

const WIND_DOWN_OPTIONS = [0, 15, 30, 45, 60] as const;

/** Control del modo dormir en la pantalla de la noche (también está en el panel rápido de Android). */
export function FocusCard({ onMorningUnlock }: { onMorningUnlock: () => void }) {
  const [cfg, setCfg] = useState<FocusConfig | null>(null);
  const [state, setState] = useState<SleepState>(IDLE_STATE);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [windDown, setWindDown] = useState<number | null>(null);

  const refresh = useCallback(() => {
    void loadFocusConfig().then(setCfg);
    void getSleepState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  // La cuenta atrás se actualiza cada segundo; al terminar, se relee el estado.
  useEffect(() => {
    if (state.phase !== 'wind_down') return;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= state.sleepAt) refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [state, refresh]);

  if (!cfg) return null;
  const ready = focusSupported && cfg.enabled && cfg.packages.length > 0;
  const chosen = windDown ?? cfg.windDownMin;

  async function start() {
    haptic('commit');
    setState(await startSleep(chosen));
  }

  return (
    <>
      {state.phase === 'morning' && (
        <div className="card banner">
          <p>☀️ Tus apps siguen en pausa hasta que te levantes.</p>
          <button className="primary" onClick={onMorningUnlock}>
            {cfg.challenge === 'steps' ? `🚶 Caminar ${cfg.steps} pasos` : '✍️ Anotar mi sueño'}
          </button>
        </div>
      )}
      <section className="card sleep-card">
        <div className="row">
          <h3 className="grow">😴 Modo dormir</h3>
          <button className="small" onClick={() => setOpen(true)}>
            {ready ? 'Ajustes' : 'Configurar'}
          </button>
        </div>

        {!focusSupported ? (
          <p className="muted small">
            Pausa Instagram, TikTok y compañía al irte a dormir, y no las suelta por la mañana hasta que te levantas (app de
            Android).
          </p>
        ) : !ready ? (
          <p className="muted small">
            Un botón (aquí o en el panel rápido) que, tras una cuenta atrás, pausa las apps que te roban el sueño. Por la
            mañana siguen en pausa hasta que te levantas de verdad.
          </p>
        ) : state.phase === 'idle' ? (
          <>
            <Segmented
              label="Cuenta atrás"
              value={String(chosen)}
              onChange={(v) => setWindDown(Number(v))}
              options={WIND_DOWN_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? 'Ya' : `${m}′` }))}
            />
            <button className="primary wide" onClick={() => void start()}>
              {chosen === 0 ? 'Pausar apps ahora' : `Activar · pausa en ${chosen} min`}
            </button>
          </>
        ) : state.phase === 'wind_down' ? (
          <>
            <p className="sleep-countdown">{countdown(state.sleepAt - now)}</p>
            <p className="muted small center">
              Las apps se pausan a las {fmtClock(new Date(state.sleepAt))}. Ve preparándote: luz baja, móvil a cargar.
            </p>
            <button className="ghost small" onClick={() => void cancelSleep().then(setState)}>
              Cancelar
            </button>
          </>
        ) : state.phase === 'sleep' ? (
          <>
            <p className="muted small">
              🌙 Apps en pausa desde las {fmtClock(new Date(state.sleepAt))}. Despertarás «oficialmente» la primera vez que
              desbloquees el teléfono a partir de las {fmtClock(new Date(wakeDetectionFrom(state, cfg)))}.
            </p>
            <button className="ghost small" onClick={() => void cancelSleep().then(setState)}>
              Cancelar modo dormir
            </button>
          </>
        ) : (
          <p className="muted small">Completa el reto para recuperar tus apps.</p>
        )}
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
