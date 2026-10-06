import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { db } from '../lib/db';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Program, Track } from '../lib/types';

const AWAKE_GAIN = volumeToGain(72);
const VISUALIZE_SEC = 180;

/**
 * Preparación antes de dormir. Es la mitad del método: de noche solo se puede
 * reactivar lo que se asoció despierto con la misma señal.
 */
export function PrepareScreen({ program, onClose }: { program: Program; onClose: () => void }) {
  const { tracks, refresh } = useStore();
  const myTracks = useMemo(
    () => program.trackIds.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => !!t),
    [program, tracks],
  );
  const [done, setDone] = useState(false);

  useEffect(() => () => engine.stopCues(), []);

  async function finish() {
    await db.programs.save({ ...program, lastPreparedAt: Date.now() });
    await refresh();
    setDone(true);
  }

  return (
    <div className="fullscreen prepare">
      <header className="row">
        <h2 className="grow">{program.name}</h2>
        <button className="ghost icon" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </header>
      {done ? (
        <div className="center-col">
          <p className="big">✓</p>
          <p>Listo. Esta noche la señal reactivará lo que acabas de {program.goal === 'review' ? 'estudiar' : 'imaginar'}.</p>
          <p className="muted">Ve a dormir pronto: funciona mejor si duermes en las horas siguientes.</p>
          <button className="primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      ) : program.goal === 'review' ? (
        <StudyCards program={program} tracks={myTracks} onFinish={finish} />
      ) : (
        <Visualize program={program} tracks={myTracks} onFinish={finish} />
      )}
    </div>
  );
}

function StudyCards({ program, tracks, onFinish }: { program: Program; tracks: Track[]; onFinish: () => void }) {
  const cards = useMemo(() => {
    const fromNotes = program.notes
      .split(/\n\s*\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    return fromNotes.length ? fromNotes : tracks.map((t) => t.text || t.name);
  }, [program, tracks]);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!cards.length) return;
    let cancelled = false;
    void (async () => {
      if (program.cue) await engine.playCue(program.cue, AWAKE_GAIN);
      // Si no hay apuntes, las tarjetas son las pistas: se escuchan tras la señal.
      if (!cancelled && !program.notes.trim() && tracks[i]) await engine.playTrack(tracks[i], AWAKE_GAIN);
    })();
    return () => {
      cancelled = true;
      engine.stopCues();
    };
  }, [i, cards.length, program, tracks]);

  if (!cards.length) {
    return (
      <div className="center-col">
        <p>Añade apuntes o pistas a este objetivo para poder estudiar con la señal.</p>
      </div>
    );
  }

  const last = i === cards.length - 1;
  return (
    <div className="study">
      <p className="muted small">
        Lee cada tarjeta con atención mientras suena la señal: esa asociación es la que se reactivará en tu sueño
        profundo. Tarjeta {i + 1} de {cards.length}.
      </p>
      <progress value={i + 1} max={cards.length} />
      <article className="study-card">{cards[i]}</article>
      <div className="actions">
        <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
          ◀
        </button>
        <button onClick={() => program.cue && void engine.playCue(program.cue, AWAKE_GAIN)} disabled={!program.cue}>
          🔔 Señal
        </button>
        {last ? (
          <button className="primary" onClick={onFinish}>
            Terminar
          </button>
        ) : (
          <button className="primary" onClick={() => setI(i + 1)}>
            ▶
          </button>
        )}
      </div>
    </div>
  );
}

function Visualize({ program, tracks, onFinish }: { program: Program; tracks: Track[]; onFinish: () => void }) {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(VISUALIZE_SEC);
  const stop = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    if (!running) return;
    stop.current = false;
    const t0 = Date.now();
    const timer = setInterval(() => {
      const l = Math.max(0, VISUALIZE_SEC - Math.round((Date.now() - t0) / 1000));
      setLeft(l);
      if (l === 0) {
        clearInterval(timer);
        stop.current = true;
        setRunning(false);
        finishRef.current();
      }
    }, 500);
    void (async () => {
      // Señal y pistas en bucle, con pausas para imaginar.
      for (let k = 0; !stop.current; k++) {
        if (program.cue) await engine.playCue(program.cue, AWAKE_GAIN);
        const t = tracks.length ? tracks[k % tracks.length] : null;
        if (t && !stop.current) await engine.playTrack(t, AWAKE_GAIN);
        await new Promise((r) => setTimeout(r, 12000));
      }
    })();
    return () => {
      stop.current = true;
      clearInterval(timer);
      engine.stopCues();
    };
  }, [running, program, tracks]);

  const isDream = program.goal === 'dream';
  return (
    <div className="study">
      <p className="muted small">
        {isDream
          ? 'Cierra los ojos e imagina la escena con todos los sentidos: dónde estás, qué ves, qué oyes, qué sientes. Al terminar, repite: «Esta noche voy a soñar con esto».'
          : 'Repite tu mantra despacio, sintiéndolo. Respira lento: inhala 4 s, exhala 6 s.'}
      </p>
      <article className="study-card intention">{program.notes || program.name}</article>
      {running ? (
        <div className="center-col">
          <p className="big">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </p>
          <button
            onClick={() => {
              stop.current = true;
              setRunning(false);
              onFinish();
            }}
          >
            Terminar ya
          </button>
        </div>
      ) : (
        <button className="primary wide" onClick={() => setRunning(true)}>
          {isDream ? 'Empezar visualización (3 min)' : 'Empezar (3 min)'}
        </button>
      )}
    </div>
  );
}
