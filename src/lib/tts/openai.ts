import { db } from '../db';
import type { SynthSpec } from '../types';

/**
 * Voz en la nube (OpenAI gpt-4o-mini-tts): la más natural y expresiva; acepta
 * indicaciones de estilo en lenguaje natural. Usa la clave del propio usuario,
 * guardada solo en este dispositivo.
 */

export const OPENAI_VOICES: Array<{ id: string; label: string }> = [
  { id: 'marin', label: 'Marin · cálida' },
  { id: 'cedar', label: 'Cedar · grave y serena' },
  { id: 'ash', label: 'Ash · firme' },
  { id: 'ballad', label: 'Ballad · narrativa' },
  { id: 'coral', label: 'Coral · amable' },
  { id: 'sage', label: 'Sage · tranquila' },
  { id: 'verse', label: 'Verse · teatral' },
  { id: 'onyx', label: 'Onyx · profunda' },
  { id: 'nova', label: 'Nova · luminosa' },
  { id: 'shimmer', label: 'Shimmer · suave' },
  { id: 'fable', label: 'Fable · cuentacuentos' },
  { id: 'echo', label: 'Echo · neutra' },
  { id: 'alloy', label: 'Alloy · neutra' },
];

const KEY = 'openaiKey';
export const getOpenAIKey = () => db.meta.get<string>(KEY);
export const setOpenAIKey = (k: string) => (k ? db.meta.set(KEY, k.trim()) : db.meta.remove(KEY));

/** Traduce los controles a indicaciones de estilo para el modelo. */
export function buildInstructions(spec: SynthSpec): string {
  const pace =
    spec.speed < 0.75 ? 'muy despacio, sin prisa' : spec.speed < 0.92 ? 'despacio y con calma' : spec.speed > 1.15 ? 'con ritmo ágil' : 'a ritmo natural';
  const expr =
    spec.expressiveness < 30
      ? 'entonación serena y uniforme'
      : spec.expressiveness > 70
        ? 'mucha expresividad, emoción y matices'
        : 'expresividad natural';
  const rhythm = spec.rhythm > 70 ? 'Varía el ritmo como al contar una historia.' : spec.rhythm < 30 ? 'Mantén un ritmo regular, casi hipnótico.' : '';
  return [
    spec.instructions?.trim(),
    `Habla ${pace}, con ${expr}. ${rhythm}`,
    'Respeta las pausas en los puntos suspensivos y entre frases.',
    'Volumen íntimo y suave: quien escucha se está quedando dormido.',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function openaiSynth(text: string, spec: SynthSpec): Promise<AudioBuffer> {
  const key = await getOpenAIKey();
  if (!key) throw new Error('Añade tu clave de OpenAI para usar la voz en la nube');
  const input = text
    .replace(/\[pausa(?:\s+[\d.,]+)?\s*s?\]/gi, '...')
    .trim();
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: spec.voice,
      input,
      instructions: buildInstructions(spec),
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error?.message ?? msg;
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(res.status === 401 ? 'Clave de OpenAI no válida' : `OpenAI: ${msg}`);
  }
  const data = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 24000);
  return ctx.decodeAudioData(data);
}
