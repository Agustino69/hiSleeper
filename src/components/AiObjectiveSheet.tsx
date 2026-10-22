import { useRef, useState } from 'react';
import { writeObjective } from '../lib/ai/scriptwriter';
import { GOAL_INFO } from '../lib/format';
import type { Template } from '../lib/tts/presets';
import type { Goal } from '../lib/types';
import { GeminiKeyField, useGeminiKey } from './GeminiKey';
import { Segmented } from './Segmented';
import { Sheet, type SheetHandle } from './ui';

const PLACEHOLDER: Record<Goal, string> = {
  dream: 'p. ej. explorar una ciudad submarina con delfines que brillan',
  mantra: 'p. ej. dejar de preocuparme por el trabajo antes de dormir',
  review: 'Pega aquí tus apuntes (definiciones, fechas, vocabulario…). La IA solo usará lo que pegues.',
};

/** Describe una idea y Gemini crea un objetivo completo (guiones, voz, señal y fondo). */
export function AiObjectiveSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Template) => void }) {
  const gemini = useGeminiKey();
  const [goal, setGoal] = useState<Goal>('dream');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sheet = useRef<SheetHandle>(null);
  const created = useRef<Template | null>(null);

  async function go() {
    setError('');
    setBusy(true);
    try {
      created.current = await writeObjective(goal, idea);
      sheet.current?.dismiss();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="✨ Crear con IA"
      ref={sheet}
      onClose={() => {
        onClose();
        if (created.current) onCreated(created.current);
      }}
    >
      <p className="muted small">
        Describe lo que quieres y Gemini preparará el objetivo: guiones listos para la voz, estilo, señal y fondo. Podrás
        revisarlo antes de crearlo.
      </p>
      <Segmented
        label="Tipo de objetivo"
        value={goal}
        onChange={setGoal}
        options={(Object.keys(GOAL_INFO) as Goal[]).map((g) => ({ value: g, label: `${GOAL_INFO[g].icon} ${g === 'dream' ? 'Soñar' : g === 'mantra' ? 'Mantra' : 'Repasar'}` }))}
      />
      <textarea rows={goal === 'review' ? 7 : 3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={PLACEHOLDER[goal]} aria-label="Tu idea" />
      <GeminiKeyField hasKey={gemini.hasKey} onSave={gemini.save} />
      {error && <small className="error">{error}</small>}
      <button className="primary" type="button" disabled={busy || !idea.trim() || !gemini.hasKey} onClick={() => void go()}>
        {busy ? 'Creando…' : '✨ Crear objetivo'}
      </button>
      <small className="muted">Tu texto se envía a Google para generarlo (Gemini, nivel gratuito).</small>
    </Sheet>
  );
}
