import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { db } from '../lib/db';
import { MotionMonitor, ScreenLock } from '../lib/device';
import { fmtClock, fmtMinutes } from '../lib/format';
import { NightRunner, type RunnerState } from '../lib/night';
import { volumeToGain, WINDOW_LABELS, type Stage } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { NightLog } from '../lib/types';
import { Hypnogram } from '../components/Hypnogram';

const STAGE_NAME: Record<Stage, string> = {
  wake: 'quedándote dormido',
  N1: 'sueño ligero',
  N2: 'sueño ligero',
  N3: 'sueño profundo',
  REM: 'REM',
};

/** Pantalla negra durante la noche. Un toque muestra los controles unos segundos. */
export function NightMode({ log, onExit }: { log: NightLog; onExit: (journalFor?: string) => void }) {
  const { programs, tracks, refresh } = useStore();
  const [state, setState] = useState<RunnerState | null>(null);
  const [controls, setControls] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const runnerRef = useRef<NightRunner | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tonight = useMemo(() => programs.filter((p) => log.programIds.includes(p.id)), [programs, log.programIds]);

  useEffect(() => {
    const s = log.settings;
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const lock = new ScreenLock();
    const motion = new MotionMonitor();
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void db.nights.save(log), 3000);
    };

    const runner = new NightRunner({
      log,
      programs: tonight,
      tracks: trackMap,
      player: engine,
      onState: setState,
      onLogChange: persist,
      onFinish: () => {
        log.endedAt = Date.now();
        void db.nights.save(log);
        void db.activeNight.set(null);
        if (s.gentleAlarm && s.wakeTime) setAlarm(true);
        else void engine.fadeOutNoise(60);
        setControls(true);
      },
    });
    runnerRef.current = runner;

    void (async () => {
      await lock.enable();
      await engine.setNoise(s.noise, volumeToGain(s.noiseVolume), 20);
      await engine.preload(
        tonight.flatMap((p) => (p.cue ? [p.cue] : [])),
        tonight.flatMap((p) => p.trackIds.map((id) => trackMap.get(id)!).filter(Boolean)),
      );
      if (s.motionSensitivity > 0) motion.start(s.motionSensitivity, (i) => runner.onMotion(i, s.motionPauseMin));
      runner.start();
    })();

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Sesión nocturna', artist: 'hiSleeper' });
    }

    return () => {
      runner.stop();
      motion.stop();
      void lock.disable();
      clearTimeout(saveTimer);
      void db.nights.save(log);
    };
    // La sesión se monta una vez por noche.
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  // Despertador suave: el cuenco sube de volumen durante ~3 min.
  useEffect(() => {
    if (!alarm) return;
    let stop = false;
    const s = log.settings;
    void (async () => {
      const t0 = Date.now();
      while (!stop && Date.now() - t0 < 15 * 60000) {
        const k = Math.min(1, (Date.now() - t0) / 180000);
        const v = s.cueVolume + (80 - s.cueVolume) * k;
        await engine.playCue('cuenco', volumeToGain(v));
        await new Promise((r) => setTimeout(r, 6000));
      }
    })();
    void engine.fadeOutNoise(120);
    return () => {
      stop = true;
      engine.stopCues();
    };
  }, [alarm, log.settings]);

  function poke() {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setControls(false);
      setConfirmEnd(false);
    }, 8000);
  }

  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, []);

  async function end(goJournal: boolean) {
    runnerRef.current?.stop();
    setAlarm(false);
    await engine.stopAll();
    engine.stopKeepAlive();
    if (!log.endedAt) {
      log.endedAt = Date.now();
      log.events.push({ t: (Date.now() - log.startedAt) / 60000, type: 'end', label: 'Terminada manualmente' });
    }
    await db.nights.save(log);
    await db.activeNight.set(null);
    await refresh();
    onExit(goJournal ? log.id : undefined);
  }

  const runner = runnerRef.current;
  const finished = state?.finished;
  const paused = state?.pausedUntil != null;

  return (
    <div className={`night ${controls ? 'show' : ''}`} onClick={poke}>
      <div className="night-clock">{fmtClock(clock)}</div>

      {finished ? (
        <div className="night-panel" onClick={(e) => e.stopPropagation()}>
          <h2>Buenos días</h2>
          <p>Antes de moverte, quédate quieto un momento e intenta recordar qué soñabas.</p>
          <button className="primary huge" onClick={() => end(true)}>
            ✍️ Anotar mi sueño
          </button>
          <button onClick={() => end(false)}>{alarm ? 'Apagar alarma' : 'Cerrar'}</button>
        </div>
      ) : (
        controls && (
          <div className="night-panel" onClick={(e) => e.stopPropagation()}>
            {state && (
              <>
                <p className="night-status">
                  {paused
                    ? `En pausa hasta las ${fmtClock(new Date(state.pausedUntil!))}`
                    : state.window
                      ? `▶ ${WINDOW_LABELS[state.window.kind]}`
                      : state.nextWindow
                        ? `Silencio · próxima ventana a las ${fmtClock(new Date(log.startedAt + state.nextWindow.start * 60000))}`
                        : 'Silencio hasta despertar'}
                </p>
                <p className="muted small">
                  Estimado: {state.stage ? STAGE_NAME[state.stage] : '—'} · {state.cuesPlayed} reproducciones · quedan{' '}
                  {fmtMinutes(state.total - state.t)}
                </p>
                {runner && (
                  <Hypnogram
                    hypnogram={runner.hypnogram}
                    windows={runner.windows}
                    totalMin={log.totalMin}
                    start={new Date(log.startedAt)}
                    nowMin={state.t}
                  />
                )}
              </>
            )}
            <div className="actions">
              {paused ? (
                <button onClick={() => runner?.resume()}>Reanudar</button>
              ) : (
                <button onClick={() => runner?.pause(15)}>Me desperté · pausar 15 min</button>
              )}
              {confirmEnd ? (
                <button className="danger" onClick={() => end(false)}>
                  Sí, terminar
                </button>
              ) : (
                <button className="ghost" onClick={() => setConfirmEnd(true)}>
                  Terminar noche
                </button>
              )}
            </div>
            <p className="muted small">La pantalla se oscurece en unos segundos. Toca para ver esto de nuevo.</p>
          </div>
        )
      )}
    </div>
  );
}
