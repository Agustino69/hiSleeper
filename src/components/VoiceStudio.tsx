import { useEffect, useRef, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { db, uid } from '../lib/db';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import { getOpenAIKey, OPENAI_VOICES, setOpenAIKey } from '../lib/tts/openai';
import { DEFAULT_PIPER_VOICE, PIPER_VOICES } from '../lib/tts/piper';
import { specFromStyle, styleById, VOICE_STYLES } from '../lib/tts/presets';
import { encodeWav, renderVoice } from '../lib/tts/render';
import { usePiperVoice } from '../lib/tts/usePiper';
import type { SynthSpec, Track } from '../lib/types';
import { Sheet } from './ui';

type EngineChoice = SynthSpec['engine'] | 'system';

const PREVIEW_GAIN = volumeToGain(78);

/** Crea o edita una pista de voz generada: estilos, motor, voz y ajustes finos. */
export function VoiceStudio({ track, onClose }: { track?: Track; onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState(track?.name ?? '');
  const [text, setText] = useState(track?.text ?? '');
  const [engineChoice, setEngineChoice] = useState<EngineChoice>(track?.kind === 'tts' ? 'system' : (track?.synth?.engine ?? 'piper'));
  const [spec, setSpec] = useState<SynthSpec>(
    () => track?.synth ?? specFromStyle(VOICE_STYLES[0], 'piper', DEFAULT_PIPER_VOICE),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showFine, setShowFine] = useState(!!track);
  const preview = useRef<{ key: string; buf: AudioBuffer } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const piper = usePiperVoice(spec.engine === 'piper' ? spec.voice : DEFAULT_PIPER_VOICE);

  useEffect(() => {
    void getOpenAIKey().then((k) => setHasKey(!!k));
    return () => engine.stopCues();
  }, []);

  const set = (patch: Partial<SynthSpec>) => setSpec((s) => ({ ...s, ...patch }));

  function chooseEngine(e: EngineChoice) {
    setEngineChoice(e);
    if (e === 'system') return;
    const style = styleById(spec.styleId);
    if (e !== spec.engine) set({ engine: e, voice: e === 'openai' ? (style?.openaiVoice ?? 'marin') : (style?.piperVoice ?? DEFAULT_PIPER_VOICE) });
  }

  function applyStyle(id: string) {
    const style = styleById(id)!;
    const engineNow = engineChoice === 'system' ? 'piper' : engineChoice;
    setSpec(specFromStyle(style, engineNow));
  }

  function insertPause() {
    const el = textRef.current;
    const at = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)} [pausa 2] ${text.slice(at)}`;
    setText(next);
  }

  const cacheKey = JSON.stringify([text, spec]);

  async function generate(): Promise<AudioBuffer> {
    if (preview.current?.key === cacheKey) return preview.current.buf;
    const buf = await renderVoice(text, spec, (d, t) => setBusy(t > 1 ? `Generando frase ${Math.min(d + 1, t)} de ${t}…` : 'Generando…'));
    preview.current = { key: cacheKey, buf };
    return buf;
  }

  async function listen() {
    setError('');
    engine.stopCues();
    try {
      if (engineChoice === 'system') {
        setBusy('Hablando…');
        await engine.playTrack(systemTrack(), PREVIEW_GAIN);
      } else {
        setBusy('Generando…');
        const buf = await generate();
        setBusy('Reproduciendo…');
        await engine.playBuffer(buf, PREVIEW_GAIN);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function systemTrack(): Track {
    return {
      id: track?.id ?? uid(),
      name: name.trim() || text.trim().slice(0, 30),
      kind: 'tts',
      text: text.trim(),
      ttsRate: spec.speed * 0.95,
      createdAt: track?.createdAt ?? Date.now(),
    };
  }

  async function save() {
    if (!text.trim()) return;
    setError('');
    try {
      let next: Track;
      if (engineChoice === 'system') {
        next = systemTrack();
      } else {
        setBusy('Generando…');
        const buf = await generate();
        const blobKey = await db.blobs.add(encodeWav(buf));
        next = {
          id: track?.id ?? uid(),
          name: name.trim() || `${styleById(spec.styleId)?.icon ?? '✨'} ${text.trim().slice(0, 28)}`,
          kind: 'voice',
          text: text.trim(),
          synth: spec,
          blobKey,
          mime: 'audio/wav',
          durationSec: buf.duration,
          createdAt: track?.createdAt ?? Date.now(),
        };
      }
      if (track?.blobKey && track.blobKey !== next.blobKey) await db.blobs.remove(track.blobKey);
      await db.tracks.save(next);
      engine.forgetTrack(next.id);
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const piperBlocked = engineChoice === 'piper' && piper.ready === false;
  const openaiBlocked = engineChoice === 'openai' && !hasKey;
  const blocked = !text.trim() || piperBlocked || openaiBlocked || !!busy;

  return (
    <Sheet title={track ? 'Editar voz' : 'Estudio de voz'} onClose={onClose}>
      <label className="field">
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Pirata · zarpar" />
      </label>

      <label className="field">
        <span className="field-row">
          <span>Guion</span>
          <button className="small" onClick={insertPause} type="button">
            + pausa
          </button>
        </span>
        <textarea
          ref={textRef}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Esta noche eres el capitán de un barco pirata... Sientes el viento salado."
        />
        <small>
          «...» alarga la pausa · línea en blanco = pausa de párrafo · [pausa 3] = 3 segundos de silencio. Frases cortas,
          en presente y con detalles de los sentidos.
        </small>
      </label>

      <fieldset className="field">
        <legend>Estilo</legend>
        <div className="style-grid">
          {VOICE_STYLES.map((s) => (
            <button key={s.id} className={`style-card ${spec.styleId === s.id ? 'on' : ''}`} onClick={() => applyStyle(s.id)} type="button">
              <span className="style-icon">{s.icon}</span>
              <b>{s.label}</b>
              <small>{s.blurb}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Motor de voz</legend>
        <div className="segmented">
          <button className={engineChoice === 'piper' ? 'on' : ''} onClick={() => chooseEngine('piper')} type="button">
            Neural
            <small>en el teléfono</small>
          </button>
          <button className={engineChoice === 'openai' ? 'on' : ''} onClick={() => chooseEngine('openai')} type="button">
            Nube
            <small>más expresiva</small>
          </button>
          <button className={engineChoice === 'system' ? 'on' : ''} onClick={() => chooseEngine('system')} type="button">
            Básica
            <small>del sistema</small>
          </button>
        </div>

        {engineChoice === 'piper' && (
          <>
            <select value={spec.voice} onChange={(e) => set({ voice: e.target.value })} aria-label="Voz">
              {PIPER_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.accent}
                </option>
              ))}
            </select>
            {piper.ready === false &&
              (piper.progress != null ? (
                <div className="download">
                  <progress value={piper.progress} max={1} />
                  <small>Descargando… {Math.round(piper.progress * 100)}%</small>
                </div>
              ) : (
                <button className="primary" onClick={piper.download} type="button">
                  ⬇ Descargar voz ({piper.sizeMb} MB, una sola vez)
                </button>
              ))}
            {piper.ready && <small className="ok">✓ Lista · funciona sin conexión</small>}
            {piper.error && <small className="error">{piper.error}</small>}
          </>
        )}

        {engineChoice === 'openai' && (
          <>
            <select value={spec.voice} onChange={(e) => set({ voice: e.target.value })} aria-label="Voz">
              {OPENAI_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            {hasKey ? (
              <small className="ok">
                ✓ Clave guardada en este dispositivo ·{' '}
                <button
                  className="link"
                  type="button"
                  onClick={async () => {
                    await setOpenAIKey('');
                    setHasKey(false);
                  }}
                >
                  quitar
                </button>
              </small>
            ) : (
              <div className="row">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Clave de API de OpenAI (sk-…)"
                  autoComplete="off"
                />
                <button
                  className="primary"
                  type="button"
                  disabled={!keyDraft.trim()}
                  onClick={async () => {
                    await setOpenAIKey(keyDraft);
                    setKeyDraft('');
                    setHasKey(true);
                  }}
                >
                  Guardar
                </button>
              </div>
            )}
            <label className="field">
              <span>Indicaciones de actuación</span>
              <textarea rows={3} value={spec.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value })} />
              <small>
                Describe cómo debe sonar: emoción, personaje, acento… El texto se envía a OpenAI para generar el audio una
                vez; después la pista funciona sin conexión.
              </small>
            </label>
          </>
        )}

        {engineChoice === 'system' && (
          <small className="muted">
            Sin descarga ni conexión, pero suena robótica, no admite efectos y se reproduce en directo (algunos móviles
            ignoran su volumen).
          </small>
        )}
      </fieldset>

      <section className="field">
        <button className="ghost wide" onClick={() => setShowFine(!showFine)} type="button">
          {showFine ? '▾' : '▸'} Ajustes finos
        </button>
        {showFine && (
          <div className="fine">
            <Fine label="Ritmo" value={spec.speed} min={0.6} max={1.4} step={0.02} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ speed: v })} hint="Más bajo = más pausado." />
            {engineChoice !== 'system' && (
              <>
                <Fine label="Expresividad" value={spec.expressiveness} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ expressiveness: v })} hint="Entonación plana ↔ emotiva. Muy alta puede sonar inestable." />
                <Fine label="Naturalidad del ritmo" value={spec.rhythm} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ rhythm: v })} hint="Regular, casi hipnótico ↔ variado, como al contar una historia." />
                {engineChoice === 'piper' && (
                  <Fine label="Tono" value={spec.pitch} min={-6} max={6} step={0.5} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v) => set({ pitch: v })} hint="Más grave ↔ más agudo, sin cambiar la velocidad." />
                )}
                {engineChoice === 'piper' && (
                  <Fine label="Pausa entre frases" value={spec.pause} min={0} max={4} step={0.1} fmt={(v) => `${v.toFixed(1)} s`} onChange={(v) => set({ pause: v })} />
                )}
                <Fine label="Espacio (eco)" value={spec.reverb} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ reverb: v })} hint="Seco ↔ habitación ↔ catedral." />
                <Fine label="Calidez" value={spec.warmth} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ warmth: v })} hint="Brillante ↔ cálida y suave (mejor para dormir)." />
              </>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={listen} disabled={blocked} type="button">
          ▶ Escuchar
        </button>
        <span className="grow muted small">{busy}</span>
        <button className="primary" onClick={save} disabled={blocked} type="button">
          Guardar pista
        </button>
      </div>
    </Sheet>
  );
}

function Fine(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-row">
        <span>{props.label}</span>
        <b>{props.fmt(props.value)}</b>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}
