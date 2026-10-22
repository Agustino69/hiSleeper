import { useEffect, useRef, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { db, uid } from '../lib/db';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import { GEMINI_KEY_URL, GEMINI_VOICES, getGeminiKey, setGeminiKey } from '../lib/tts/gemini';
import { PIPER_VOICES } from '../lib/tts/piper';
import { specFromStyle, styleById, VOICE_STYLES } from '../lib/tts/presets';
import { encodeWav, renderVoice } from '../lib/tts/render';
import { isSupertonicVoice, SUPERTONIC_VOICES } from '../lib/tts/supertonic';
import { usePiperVoice, useSupertonic } from '../lib/tts/usePiper';
import type { SynthSpec, Track } from '../lib/types';
import { rangeFill, Sheet, type SheetHandle } from './ui';
import { Segmented } from './Segmented';
import { toast } from '../lib/toast';
import { haptic } from '../lib/haptics';

/** device = voces en el teléfono (Supertonic naturales o Piper clásicas). */
type EngineChoice = 'device' | 'gemini' | 'system';

const PREVIEW_GAIN = volumeToGain(78);
const SAMPLE_TEXT = 'Hola. Esta noche te acompaño mientras te quedas dormido.';

const TAGS: Record<'supertonic' | 'gemini', Array<{ tag: string; label: string }>> = {
  supertonic: [
    { tag: '<breath>', label: '😮‍💨 respiración' },
    { tag: '<sigh>', label: '😌 suspiro' },
    { tag: '<laugh>', label: '🤭 risa' },
  ],
  gemini: [
    { tag: '<whispers>', label: '🤫 susurro' },
    { tag: '<breath>', label: '😮‍💨 respiración' },
    { tag: '<sigh>', label: '😌 suspiro' },
    { tag: '<yawn>', label: '🥱 bostezo' },
    { tag: '<laugh>', label: '🤭 risa' },
    { tag: '<gasp>', label: '😮 asombro' },
  ],
};

const choiceOf = (t?: Track): EngineChoice =>
  t?.kind === 'tts' ? 'system' : t?.synth?.engine === 'gemini' || t?.synth?.engine === 'openai' ? 'gemini' : 'device';

/** Crea o edita una pista de voz generada: estilos, motor, voz y ajustes finos. */
export function VoiceStudio({ track, onClose }: { track?: Track; onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState(track?.name ?? '');
  const [text, setText] = useState(track?.text ?? '');
  const [engineChoice, setEngineChoice] = useState<EngineChoice>(choiceOf(track));
  const [spec, setSpec] = useState<SynthSpec>(() => {
    const s = track?.synth;
    if (!s) return specFromStyle(VOICE_STYLES[0], 'supertonic');
    // Las pistas antiguas de OpenAI se editan con Gemini (gratis).
    return s.engine === 'openai' ? { ...s, engine: 'gemini', voice: styleById(s.styleId)?.cloudVoice ?? 'Sulafat' } : s;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showFine, setShowFine] = useState(!!track);
  const preview = useRef<{ key: string; buf: AudioBuffer } | null>(null);
  const sheet = useRef<SheetHandle>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const supertonic = useSupertonic();
  const piper = usePiperVoice(spec.engine === 'piper' ? spec.voice : PIPER_VOICES[0].id);
  const device = spec.engine === 'piper' ? piper : supertonic;

  useEffect(() => {
    void getGeminiKey().then((k) => setHasKey(!!k));
    return () => engine.stopCues();
  }, []);

  const set = (patch: Partial<SynthSpec>) => setSpec((s) => ({ ...s, ...patch }));

  function chooseEngine(e: EngineChoice) {
    setEngineChoice(e);
    if (e === 'system') return;
    const style = styleById(spec.styleId) ?? VOICE_STYLES[0];
    if (e === 'gemini' && spec.engine !== 'gemini') set({ engine: 'gemini', voice: style.cloudVoice });
    if (e === 'device' && spec.engine === 'gemini') setSpec({ ...specFromStyle(style, 'supertonic'), ...pickParams(spec) });
  }

  /** Conserva los ajustes finos al cambiar de motor. */
  const pickParams = (s: SynthSpec) => ({
    speed: s.speed,
    expressiveness: s.expressiveness,
    rhythm: s.rhythm,
    pitch: s.pitch,
    pause: s.pause,
    reverb: s.reverb,
    warmth: s.warmth,
    instructions: s.instructions,
  });

  function chooseDeviceVoice(id: string) {
    if (isSupertonicVoice(id)) set({ engine: 'supertonic', voice: id, quality: spec.quality ?? 8 });
    else set({ engine: 'piper', voice: id, mixWith: undefined, mix: undefined });
  }

  function applyStyle(id: string) {
    const style = styleById(id)!;
    const target = engineChoice === 'gemini' ? 'gemini' : spec.engine === 'piper' ? 'piper' : 'supertonic';
    setSpec({ ...specFromStyle(style, target), lang: spec.lang });
  }

  function insert(snippet: string) {
    const el = textRef.current;
    const at = el?.selectionStart ?? text.length;
    setText(`${text.slice(0, at)} ${snippet} ${text.slice(at)}`.replace(/ {2,}/g, ' '));
  }

  const cacheKey = JSON.stringify([text, spec]);

  async function generate(source = text, useCache = true): Promise<AudioBuffer> {
    if (useCache && preview.current?.key === cacheKey) return preview.current.buf;
    const buf = await renderVoice(source, spec, (d, t) => setBusy(t > 1 ? `Generando frase ${Math.min(d + 1, t)} de ${t}…` : 'Generando…'));
    if (useCache) preview.current = { key: cacheKey, buf };
    return buf;
  }

  async function play(source?: string) {
    setError('');
    engine.stopCues();
    try {
      if (engineChoice === 'system') {
        setBusy('Hablando…');
        await engine.playTrack({ ...systemTrack(), text: source ?? text }, PREVIEW_GAIN);
      } else {
        setBusy('Generando…');
        const buf = await generate(source ?? text, !source);
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
      haptic('commit');
      toast(`«${next.name}» guardada`);
      sheet.current?.dismiss();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const deviceBlocked = engineChoice === 'device' && device.ready === false;
  const geminiBlocked = engineChoice === 'gemini' && !hasKey;
  const blocked = !text.trim() || deviceBlocked || geminiBlocked || !!busy;
  const tags = engineChoice === 'gemini' ? TAGS.gemini : spec.engine === 'supertonic' && engineChoice === 'device' ? TAGS.supertonic : [];

  return (
    <Sheet title={track ? 'Editar voz' : 'Estudio de voz'} onClose={onClose} ref={sheet} size="full">
      <label className="field">
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Pirata · zarpar" />
      </label>

      <label className="field">
        <span>Guion</span>
        <textarea
          ref={textRef}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Esta noche eres el capitán de un barco pirata... Sientes el viento salado."
        />
      </label>
      <div className="chips tag-chips">
        <button className="chip" type="button" onClick={() => insert('[pausa 2]')}>
          ⏸ pausa
        </button>
        {tags.map((t) => (
          <button key={t.tag} className="chip" type="button" onClick={() => insert(t.tag)}>
            {t.label}
          </button>
        ))}
      </div>
      <small className="muted">
        «...» alarga la pausa · línea en blanco = pausa de párrafo. Frases cortas, en presente y con detalles de los
        sentidos.{spec.engine === 'piper' && engineChoice === 'device' ? ' Las voces clásicas no interpretan respiraciones ni risas.' : ''}
      </small>

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
        <Segmented
          label="Motor de voz"
          value={engineChoice}
          onChange={chooseEngine}
          options={[
            { value: 'device', label: 'Natural', hint: 'en el teléfono' },
            { value: 'gemini', label: 'Actuada', hint: 'nube · gratis' },
            { value: 'system', label: 'Básica', hint: 'del sistema' },
          ]}
        />

        {engineChoice === 'device' && (
          <>
            <div className="row">
              <select className="grow" value={spec.voice} onChange={(e) => chooseDeviceVoice(e.target.value)} aria-label="Voz">
                <optgroup label="Naturales · Supertonic 3">
                  {SUPERTONIC_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Clásicas · Piper (acento regional)">
                  {PIPER_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · {v.accent}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button className="small" type="button" disabled={!device.ready || !!busy} onClick={() => void play(SAMPLE_TEXT)}>
                ▶ Probar
              </button>
            </div>
            {device.ready === false &&
              (device.progress != null ? (
                <div className="download">
                  <progress value={device.progress} max={1} />
                  <small>Descargando… {Math.round(device.progress * 100)}%</small>
                </div>
              ) : (
                <button className="primary" onClick={device.download} type="button">
                  ⬇ Descargar voces {spec.engine === 'piper' ? 'clásicas' : 'naturales'} ({device.sizeMb} MB, una sola vez)
                </button>
              ))}
            {device.ready && <small className="ok">✓ Lista · funciona sin conexión</small>}
            {device.error && <small className="error">{device.error}</small>}
          </>
        )}

        {engineChoice === 'gemini' && (
          <>
            <div className="row">
              <select className="grow" value={spec.voice} onChange={(e) => set({ voice: e.target.value })} aria-label="Voz">
                {GEMINI_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button className="small" type="button" disabled={!hasKey || !!busy} onClick={() => void play(SAMPLE_TEXT)}>
                ▶ Probar
              </button>
            </div>
            {hasKey ? (
              <small className="ok">
                ✓ Clave guardada en este dispositivo ·{' '}
                <button
                  className="link"
                  type="button"
                  onClick={async () => {
                    await setGeminiKey('');
                    setHasKey(false);
                  }}
                >
                  quitar
                </button>
              </small>
            ) : (
              <>
                <small className="muted">
                  Gratis con tu cuenta de Google: crea una clave en{' '}
                  <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer">
                    Google AI Studio
                  </a>{' '}
                  (sin tarjeta) y pégala aquí. El plan gratuito tiene un límite de usos por minuto y por día.
                </small>
                <div className="row">
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="Clave de Google AI Studio"
                    autoComplete="off"
                  />
                  <button
                    className="primary"
                    type="button"
                    disabled={!keyDraft.trim()}
                    onClick={async () => {
                      await setGeminiKey(keyDraft);
                      setKeyDraft('');
                      setHasKey(true);
                    }}
                  >
                    Guardar
                  </button>
                </div>
              </>
            )}
            <label className="field">
              <span>Indicaciones de actuación</span>
              <textarea rows={3} value={spec.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value })} />
              <small>
                Describe cómo debe sonar: emoción, personaje, ritmo… El texto se envía a Google una vez para generar el
                audio; después la pista funciona sin conexión.
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
                <Fine label="Expresividad" value={spec.expressiveness} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ expressiveness: v })} hint="Entonación plana ↔ emotiva." />
                {spec.engine !== 'supertonic' && (
                  <Fine label="Naturalidad del ritmo" value={spec.rhythm} min={0} max={100} fmt={(v) => `${v}`} onChange={(v) => set({ rhythm: v })} hint="Regular, casi hipnótico ↔ variado, como al contar una historia." />
                )}
                {spec.engine === 'supertonic' && engineChoice === 'device' && (
                  <>
                    <label className="field">
                      <span>Mezclar timbre con</span>
                      <select value={spec.mixWith ?? ''} onChange={(e) => set({ mixWith: e.target.value || undefined, mix: e.target.value ? (spec.mix ?? 30) : undefined })}>
                        <option value="">— ninguna —</option>
                        {SUPERTONIC_VOICES.filter((v) => v.id !== spec.voice).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {spec.mixWith && (
                      <Fine label="Mezcla" value={spec.mix ?? 30} min={0} max={100} step={5} fmt={(v) => `${v}%`} onChange={(v) => set({ mix: v })} hint="Crea una voz intermedia entre las dos." />
                    )}
                    <Fine label="Calidad" value={spec.quality ?? 8} min={4} max={12} fmt={(v) => `${v} pasos`} onChange={(v) => set({ quality: v })} hint="Más pasos = voz más pulida, pero tarda más en generarse." />
                  </>
                )}
                {engineChoice === 'device' && (
                  <Fine label="Tono" value={spec.pitch} min={-6} max={6} step={0.5} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v) => set({ pitch: v })} hint="Más grave ↔ más agudo, sin cambiar la velocidad." />
                )}
                {engineChoice === 'device' && (
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
        <button onClick={() => void play()} disabled={blocked} type="button">
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
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        style={rangeFill(props.value, props.min, props.max)}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}
