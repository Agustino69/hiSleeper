import { useEffect, useMemo, useRef, useState } from 'react';
import { StepDetector, type FocusConfig, type SleepState } from '../lib/focus';
import { backToSleep, completeMorning, Focus, getSleepState, loadFocusConfig, type BlockedEvent } from '../lib/focusBridge';
import { fmtClock } from '../lib/format';
import { haptic } from '../lib/haptics';

const NIGHT_LINES = [
  'Cada minuto de scroll ahora retrasa tu sueño. {app} seguirá ahí mañana.',
  'La luz y los estímulos mantienen tu cerebro en alerta. Deja que baje el ritmo.',
  'Lo que veas ahora no va a cambiar tu noche… pero dormir bien sí cambiará tu mañana.',
  'Tu cerebro está a punto de ordenar el día. Dale silencio.',
];

/**
 * Aparece cuando se intenta abrir una app bloqueada (o al pulsar «Desbloquear»
 * por la mañana). De noche invita a dormir; de mañana pide levantarse primero.
 */
export function BlockedScreen({
  event,
  onClose,
  onStartNight,
  onJournal,
}: {
  event: BlockedEvent;
  onClose: () => void;
  onStartNight: () => void;
  onJournal: () => void;
}) {
  const [cfg, setCfg] = useState<FocusConfig | null>(null);
  useEffect(() => {
    void loadFocusConfig().then(setCfg);
  }, []);
  if (!cfg) return null;
  return event.kind === 'morning' ? (
    <MorningLock cfg={cfg} event={event} onClose={onClose} onJournal={onJournal} />
  ) : (
    <NightLock cfg={cfg} event={event} onClose={onClose} onStartNight={onStartNight} />
  );
}

function NightLock({ cfg, event, onClose, onStartNight }: { cfg: FocusConfig; event: BlockedEvent; onClose: () => void; onStartNight: () => void }) {
  const app = event.label ?? 'Esa app';
  const line = useMemo(() => NIGHT_LINES[Math.floor(Math.random() * NIGHT_LINES.length)].replace('{app}', app), [app]);
  const [breathing, setBreathing] = useState<number | null>(null);

  useEffect(() => {
    if (breathing == null || breathing <= 0) return;
    const id = setTimeout(() => setBreathing(breathing - 1), 1000);
    return () => clearTimeout(id);
  }, [breathing]);

  async function openAnyway() {
    if (!event.package) return;
    await Focus.allowTemporarily({ package: event.package, minutes: cfg.overrideMin });
    await Focus.launchApp({ package: event.package });
    onClose();
  }

  return (
    <div className="fullscreen blocked night-block">
      <div className="center-col">
        <p className="blocked-moon">🌙</p>
        <h2>Es hora de desconectar</h2>
        <p>{line}</p>
        <p className="muted small">Son las {fmtClock(new Date())}.</p>
      </div>
      {breathing == null ? (
        <div className="stack">
          <button className="primary huge" onClick={onStartNight}>
            🌙 Empezar mi noche
          </button>
          <button onClick={() => void Focus.goHome().then(onClose)}>Dejar el móvil</button>
          {cfg.allowOverride && event.package ? (
            <button className="ghost small" onClick={() => setBreathing(cfg.overrideDelaySec)}>
              Necesito abrir {app}
            </button>
          ) : (
            <small className="muted center">Modo estricto: se desbloquea por la mañana.</small>
          )}
        </div>
      ) : breathing > 0 ? (
        <div className="center-col">
          <div className="breath" aria-hidden />
          <p>Respira hondo… ¿de verdad lo necesitas ahora?</p>
          <p className="big">{breathing}</p>
          <button className="primary" onClick={() => setBreathing(null)}>
            No, mejor me duermo
          </button>
        </div>
      ) : (
        <div className="stack">
          <button className="primary huge" onClick={onStartNight}>
            Mejor me duermo
          </button>
          <button onClick={() => void openAnyway()}>
            Abrir {app} {cfg.overrideMin} min
          </button>
        </div>
      )}
    </div>
  );
}

function MorningLock({ cfg, event, onClose, onJournal }: { cfg: FocusConfig; event: BlockedEvent; onClose: () => void; onJournal: () => void }) {
  const [done, setDone] = useState(false);
  const [state, setState] = useState<SleepState | null>(null);

  useEffect(() => {
    void getSleepState().then(setState);
  }, []);

  async function unlock() {
    await completeMorning();
    haptic('success');
    setDone(true);
  }

  async function sleepMore() {
    await backToSleep();
    onClose();
  }

  return (
    <div className="fullscreen blocked morning-block">
      <div className="center-col">
        <p className="blocked-moon">{done ? '🎉' : '☀️'}</p>
        <h2>{done ? '¡Desbloqueado!' : 'Buenos días. Primero, levántate.'}</h2>
        {done ? (
          <p>Ya empezaste el día en movimiento. Buen comienzo.</p>
        ) : (
          <p>
            {event.label ? `${event.label} sigue en pausa` : 'Tus apps siguen en pausa'} hasta que salgas de la cama.
            Dormir más no las desbloquea.
          </p>
        )}
        {!done && cfg.antiSnooze && (
          <p className="muted small">⏰ Si dejas el móvil y vuelves a la cama, sonará una alarma en {cfg.snoozeMin} min.</p>
        )}
      </div>
      {done ? (
        <button className="primary huge" onClick={onClose}>
          Cerrar
        </button>
      ) : cfg.challenge === 'steps' ? (
        <StepsChallenge target={cfg.steps} onDone={() => void unlock()} onFallback={onJournal} />
      ) : (
        <div className="stack">
          <p className="center">Escribe en el diario lo que recuerdes de tu sueño (al menos {cfg.journalChars} letras).</p>
          <button className="primary huge" onClick={onJournal}>
            ✍️ Anotar mi sueño
          </button>
        </div>
      )}
      {!done && (
        <div className="stack">
          {state?.canGoBackToSleep && (
            <button className="ghost small" onClick={() => void sleepMore()}>
              🌙 Aún es de madrugada: seguir durmiendo (solo una vez)
            </button>
          )}
          <button className="ghost small" onClick={onClose}>
            Ahora no
          </button>
        </div>
      )}
    </div>
  );
}

function StepsChallenge({ target, onDone, onFallback }: { target: number; onDone: () => void; onFallback: () => void }) {
  const [steps, setSteps] = useState(0);
  const [noSensor, setNoSensor] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const det = new StepDetector();
    let got = false;
    let finished = false;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      got = true;
      if (det.push(a.x, a.y, a.z, e.timeStamp)) {
        setSteps(det.count);
        if (det.count >= target && !finished) {
          finished = true;
          doneRef.current();
        }
      }
    };
    window.addEventListener('devicemotion', onMotion);
    const check = setTimeout(() => !got && setNoSensor(true), 3000);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      clearTimeout(check);
    };
  }, [target]);

  const pct = Math.min(1, steps / target);
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <div className="center-col">
      <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={`${steps} de ${target} pasos`}>
        <circle cx="90" cy="90" r={R} className="ring-bg" />
        <circle cx="90" cy="90" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 90 90)" />
        <text x="90" y="88" textAnchor="middle" className="ring-num">
          {steps}
        </text>
        <text x="90" y="112" textAnchor="middle" className="ring-label">
          de {target} pasos
        </text>
      </svg>
      <p>🚶 Camina con el móvil en la mano: al baño, a la cocina, a abrir la ventana.</p>
      {noSensor && (
        <small className="warn">
          No llegan datos del acelerómetro.{' '}
          <button className="link" onClick={onFallback}>
            Anota tu sueño en su lugar
          </button>
        </small>
      )}
    </div>
  );
}
