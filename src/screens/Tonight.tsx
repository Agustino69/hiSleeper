import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { NOISE_TYPES } from '../lib/audio/synth';
import { db, uid } from '../lib/db';
import { MotionMonitor } from '../lib/device';
import { fmtClock, fmtMinutes, GOAL_INFO, isToday } from '../lib/format';
import { estimateHypnogram, minutesUntil, planWindows, suggestWakeTimes, volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { NightLog, NightSettings, NoiseType } from '../lib/types';
import { Hypnogram } from '../components/Hypnogram';
import { Slider } from '../components/ui';

export function plannedMinutes(s: NightSettings, from: Date): number {
  return (s.wakeTime && minutesUntil(s.wakeTime, from)) || s.latencyMin + 5 * s.cycleMin;
}

export function TonightScreen({ onStart, onGoTo }: { onStart: (log: NightLog) => void; onGoTo: (tab: 'programs') => void }) {
  const { programs, settings, saveSettings } = useStore();
  const [now, setNow] = useState(() => new Date());
  const [noisePreview, setNoisePreview] = useState(false);
  const [resumable, setResumable] = useState<NightLog | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void (async () => {
      const id = await db.activeNight.get();
      const log = id ? await db.nights.get(id) : undefined;
      if (log && !log.endedAt && Date.now() < log.startedAt + log.totalMin * 60000) setResumable(log);
      else if (id) await db.activeNight.set(null);
    })();
  }, []);

  const previewRef = useRef(false);
  previewRef.current = noisePreview;
  useEffect(
    () => () => {
      if (previewRef.current) void engine.fadeOutNoise(0.5);
    },
    [],
  );

  const set = (patch: Partial<NightSettings>) => void saveSettings({ ...settings, ...patch });
  const active = programs.filter((p) => p.enabled);
  const goals = [...new Set(active.map((p) => p.goal))];
  const total = plannedMinutes(settings, now);
  const params = { latencyMin: settings.latencyMin, cycleMin: settings.cycleMin, totalMin: total };
  const hyp = useMemo(() => estimateHypnogram(params), [params.latencyMin, params.cycleMin, params.totalMin]);
  const windows = useMemo(
    () => planWindows({ ...params, goals, deepCycles: settings.deepCycles, hasWakeTime: !!settings.wakeTime }),
    [params.latencyMin, params.cycleMin, params.totalMin, goals.join(), settings.deepCycles, settings.wakeTime],
  );
  const suggestions = suggestWakeTimes(now, settings.latencyMin, settings.cycleMin);
  const unprepared = active.filter((p) => p.goal !== 'mantra' && !isToday(p.lastPreparedAt));
  const empty = active.filter((p) => !p.cue && !p.trackIds.length);

  async function toggleNoisePreview() {
    if (noisePreview) {
      await engine.fadeOutNoise(0.5);
      setNoisePreview(false);
    } else {
      await engine.setNoise(settings.noise, volumeToGain(settings.noiseVolume), 0.5);
      setNoisePreview(true);
    }
  }

  async function testVolume(v: number) {
    const p = active.find((x) => x.cue) ?? null;
    if (p?.cue) await engine.playCue(p.cue, volumeToGain(v));
    else await engine.playCue('cuenco', volumeToGain(v));
  }

  function start(resume?: NightLog) {
    // Todo lo que exige un gesto del usuario se invoca aquí, sin esperas previas.
    engine.startKeepAlive();
    const motion = settings.motionSensitivity > 0 ? MotionMonitor.requestPermission() : Promise.resolve(false);
    void Promise.all([engine.ensure(), motion]).then(async () => {
      // El ruido de la vista previa continúa: la sesión nocturna lo retoma sin cortes.
      previewRef.current = false;
      const log: NightLog = resume ?? {
        id: uid(),
        startedAt: Date.now(),
        totalMin: plannedMinutes(settings, new Date()),
        programIds: active.map((p) => p.id),
        settings: { ...settings },
        events: [],
      };
      await db.nights.save(log);
      await db.activeNight.set(log.id);
      onStart(log);
    });
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Esta noche</h1>
        <p className="muted">
          Son las {fmtClock(now)} · dormirás unas {fmtMinutes(total - settings.latencyMin)}
        </p>
      </header>

      {resumable && (
        <div className="card banner">
          <p>
            Hay una sesión en curso desde las {fmtClock(new Date(resumable.startedAt))}. ¿Seguir donde se quedó?
          </p>
          <div className="actions">
            <button className="primary" onClick={() => start(resumable)}>
              Reanudar
            </button>
            <button
              onClick={async () => {
                await db.nights.save({ ...resumable, endedAt: Date.now() });
                await db.activeNight.set(null);
                setResumable(null);
              }}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <section className="card">
        <h3>Objetivos activos</h3>
        {active.length === 0 ? (
          <p className="muted">
            Ninguno activo: solo sonará el ruido de fondo.{' '}
            <button className="link" onClick={() => onGoTo('programs')}>
              Crear un objetivo
            </button>
          </p>
        ) : (
          <ul className="plain">
            {active.map((p) => (
              <li key={p.id}>
                {GOAL_INFO[p.goal].icon} {p.name}
              </li>
            ))}
          </ul>
        )}
        {unprepared.length > 0 && (
          <p className="warn">
            Sin preparar hoy: {unprepared.map((p) => p.name).join(', ')}. La señal nocturna solo reactiva lo que asociaste
            despierto.{' '}
            <button className="link" onClick={() => onGoTo('programs')}>
              Preparar
            </button>
          </p>
        )}
        {empty.length > 0 && <p className="warn">Sin señal ni pistas: {empty.map((p) => p.name).join(', ')}.</p>}
      </section>

      <section className="card">
        <h3>Despertar</h3>
        <div className="row">
          <input
            type="time"
            value={settings.wakeTime}
            onChange={(e) => set({ wakeTime: e.target.value })}
            aria-label="Hora de despertar"
          />
          <button className="ghost" onClick={() => set({ wakeTime: '' })} disabled={!settings.wakeTime}>
            Sin hora
          </button>
        </div>
        <div className="chips">
          {suggestions.map((d, i) => (
            <button
              key={i}
              className="chip"
              onClick={() => set({ wakeTime: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` })}
            >
              {fmtClock(d)} · {i + 4} ciclos
            </button>
          ))}
        </div>
        <small className="muted">Las sugerencias caen al final de un ciclo, cuando despertar cuesta menos.</small>
        {total > 12 * 60 && (
          <p className="warn">
            Faltan {fmtMinutes(total)} para esa hora. ¿Es correcta? Elige una de las sugerencias o pulsa «Sin hora».
          </p>
        )}
        <Hypnogram hypnogram={hyp} windows={windows} totalMin={total} start={now} />
        <small className="muted">Estimación según tus ajustes; no mide tu sueño real.</small>
      </section>

      <section className="card">
        <h3>Sonido</h3>
        <label className="field">
          <span>Fondo</span>
          <select value={settings.noise} onChange={(e) => set({ noise: e.target.value as NoiseType })}>
            {NOISE_TYPES.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <Slider
          label="Volumen del fondo"
          value={settings.noiseVolume}
          min={0}
          max={100}
          onChange={(v) => {
            set({ noiseVolume: v });
            if (noisePreview) void engine.setNoise(settings.noise, volumeToGain(v), 0.2);
          }}
          action={
            <button className="small" onClick={toggleNoisePreview} disabled={settings.noise === 'none'}>
              {noisePreview ? '■' : '▶'}
            </button>
          }
          hint="El ruido de fondo enmascara los sonidos de la casa y hace que las pistas pasen desapercibidas."
        />
        <Slider
          label="Volumen al acostarte"
          value={settings.onsetVolume}
          min={0}
          max={100}
          onChange={(v) => set({ onsetVolume: v })}
          action={<button className="small" onClick={() => testVolume(settings.onsetVolume)}>▶</button>}
          hint="Mantras e intención mientras te duermes; baja poco a poco."
        />
        <Slider
          label="Volumen dormido"
          value={settings.cueVolume}
          min={0}
          max={100}
          onChange={(v) => set({ cueVolume: v })}
          action={<button className="small" onClick={() => testVolume(settings.cueVolume)}>▶</button>}
          hint="Calíbralo acostado y con el fondo sonando: debe oírse apenas. Si te despierta, bájalo."
        />
      </section>

      <section className="card">
        <button className="ghost wide" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▾' : '▸'} Ajustes del ciclo y del movimiento
        </button>
        {showAdvanced && (
          <>
            <Slider label="Tardo en dormirme" value={settings.latencyMin} min={5} max={60} step={5} unit=" min" onChange={(v) => set({ latencyMin: v })} />
            <Slider
              label="Duración de mi ciclo"
              value={settings.cycleMin}
              min={70}
              max={120}
              step={5}
              unit=" min"
              onChange={(v) => set({ cycleMin: v })}
              hint="Media de 90 min. Si sueles despertar a una hora fija sin alarma, ajústalo para que coincida."
            />
            <Slider
              label="Ciclos con repaso"
              value={settings.deepCycles}
              min={1}
              max={4}
              onChange={(v) => set({ deepCycles: v })}
              hint="El sueño profundo se concentra en los primeros ciclos."
            />
            <Slider
              label="Detector de movimiento"
              value={settings.motionSensitivity}
              min={0}
              max={5}
              onChange={(v) => set({ motionSensitivity: v })}
              hint="Deja el móvil sobre el colchón. Si te mueves, las pistas se pausan y bajan de volumen. 0 = apagado."
            />
            <Slider label="Pausa tras movimiento" value={settings.motionPauseMin} min={1} max={20} unit=" min" onChange={(v) => set({ motionPauseMin: v })} />
            <label className="field check">
              <input type="checkbox" checked={settings.gentleAlarm} onChange={(e) => set({ gentleAlarm: e.target.checked })} />
              Despertador suave (cuenco que sube poco a poco)
            </label>
          </>
        )}
      </section>

      <button className="primary huge" onClick={() => start()}>
        🌙 Dormir
      </button>
      <p className="muted small center">
        Pon el móvil a cargar, en modo avión o «no molestar», con la pantalla hacia abajo. La pantalla quedará en negro
        pero encendida para que el navegador no detenga el audio.
      </p>
    </div>
  );
}
