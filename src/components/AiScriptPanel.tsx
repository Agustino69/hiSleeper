import { useState } from 'react';
import { KIND_LABEL, writeScript, type ScriptKind, type ScriptLength } from '../lib/ai/scriptwriter';
import type { SynthSpec } from '../lib/types';
import { GeminiKeyField, type useGeminiKey } from './GeminiKey';
import { Segmented } from './Segmented';

const PLACEHOLDER: Record<ScriptKind, string> = {
  dream: 'p. ej. soy pirata y encuentro un tesoro en una isla tropical',
  mantra: 'p. ej. confianza para mi examen de mañana',
  review: 'Pega aquí tus apuntes o las palabras que quieres repasar',
  free: 'p. ej. un paseo tranquilo por un bosque nevado',
};

/** Pide a Gemini un guion con las marcas que entiende el motor de voz elegido. */
export function AiScriptPanel({
  engine,
  lang,
  styleHint,
  gemini,
  onScript,
}: {
  engine: SynthSpec['engine'] | 'system';
  lang?: string;
  styleHint?: string;
  gemini: ReturnType<typeof useGeminiKey>;
  onScript: (title: string, script: string) => void;
}) {
  const [idea, setIdea] = useState('');
  const [kind, setKind] = useState<ScriptKind>('dream');
  const [length, setLength] = useState<ScriptLength>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setError('');
    setBusy(true);
    try {
      const r = await writeScript({ idea, kind, length, engine, lang, styleHint });
      onScript(r.title, r.script);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-panel">
      <Segmented
        label="Tipo de guion"
        value={kind}
        onChange={setKind}
        options={(Object.keys(KIND_LABEL) as ScriptKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
      <textarea rows={kind === 'review' ? 5 : 2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={PLACEHOLDER[kind]} aria-label="Idea para el guion" />
      <Segmented
        label="Duración"
        value={length}
        onChange={setLength}
        options={[
          { value: 'short', label: 'Corto', hint: '~20 s' },
          { value: 'medium', label: 'Medio', hint: '~45 s' },
          { value: 'long', label: 'Largo', hint: '~1,5 min' },
        ]}
      />
      {!gemini.hasKey && <GeminiKeyField hasKey={gemini.hasKey} onSave={gemini.save} />}
      {error && <small className="error">{error}</small>}
      <button className="primary" type="button" disabled={busy || !idea.trim() || !gemini.hasKey} onClick={() => void go()}>
        {busy ? 'Escribiendo…' : '✨ Escribir guion'}
      </button>
      <small className="muted">
        Lo escribe Gemini (gratis, con tu clave de Google). Tu idea se envía a Google; puedes editar el resultado antes de
        generar la voz.
      </small>
    </section>
  );
}
