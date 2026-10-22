import { CUE_SOUNDS, NOISE_TYPES } from '../audio/synth';
import { uid } from '../db';
import { extractText, geminiRequest } from '../tts/gemini';
import { VOICE_STYLES, type Template } from '../tts/presets';
import type { CueSoundId, Goal, NoiseType, SynthSpec } from '../types';

/**
 * Guionista con Gemini (nivel gratuito, misma clave que la voz en la nube):
 * escribe los textos que luego recita la voz, con las marcas que entiende hiSleeper.
 */

export const TEXT_MODEL = 'gemini-3.8-flash';

export type ScriptKind = 'dream' | 'mantra' | 'review' | 'free';
export type ScriptLength = 'short' | 'medium' | 'long';

export const KIND_LABEL: Record<ScriptKind, string> = {
  dream: 'Sueño',
  mantra: 'Mantra',
  review: 'Repaso',
  free: 'Libre',
};

/** Palabras aproximadas (≈ 2 palabras por segundo a ritmo de dormir). */
const WORDS: Record<ScriptLength, string> = {
  short: 'entre 25 y 45 palabras (unos 20 segundos)',
  medium: 'entre 70 y 110 palabras (unos 45 segundos)',
  long: 'entre 150 y 210 palabras (minuto y medio)',
};

const KIND_GUIDE: Record<ScriptKind, string> = {
  dream:
    'Incubación de sueños: el texto suena al quedarse dormido y en el REM. Segunda persona («eres», «sientes»), presente, escena vívida con los cinco sentidos, tono maravillado y sereno, nunca amenazante. Termina invitando a soñar con ello esta noche.',
  mantra:
    'Afirmaciones para dormir y para el duermevela del amanecer: primera persona («estoy», «confío»), presente, positivas, frases muy cortas y repetibles, sin negaciones («no tengo miedo» → «estoy en calma»).',
  review:
    'Reactivación de la memoria durante el sueño: solo palabras clave y frases mínimas que recuerden lo que la persona YA estudió. No inventes datos: usa únicamente la información que te da. Ritmo lento y claro, una idea por frase.',
  free: 'Texto para escuchar al dormirse: calmado, cálido, frases cortas.',
};

export function allowedMarkup(engine: SynthSpec['engine'] | 'system'): string {
  const base = 'Marcas permitidas: «...» al final de una frase para una pausa larga, y [pausa N] para N segundos de silencio (N entre 1 y 4).';
  if (engine === 'supertonic') return `${base} Puedes usar, con mesura (como mucho 2 en total), estas etiquetas sonoras: <breath> (respiración), <sigh> (suspiro), <laugh> (risa suave). Ninguna otra.`;
  if (engine === 'gemini' || engine === 'openai')
    return `${base} Puedes usar, con mesura (como mucho 3 en total), estas etiquetas de interpretación: <whispers> (susurrando lo que sigue), <breath>, <sigh>, <yawn>, <laugh>, <gasp>. Ninguna otra.`;
  return `${base} No uses ninguna etiqueta entre < >.`;
}

const SYSTEM = `Eres guionista de audios para dormir de la app hiSleeper. Conoces la ciencia del sueño: incubación de sueños en la hipnagogia y el REM, reactivación dirigida de la memoria (TMR) en sueño profundo y afirmaciones al dormirse.
Reglas de estilo:
- Escribe para ser escuchado con voz suave por alguien que se está quedando dormido: frases cortas, ritmo lento, vocabulario sencillo.
- Nada de títulos, listas, emojis, comillas decorativas, acotaciones ni explicaciones: solo el texto que se recita.
- Contenido amable y seguro: sin violencia, miedo, contenido sexual ni promesas médicas.
- Si la idea pide algo inadecuado para dormir, suavízala hacia una versión tranquila.`;

/** Instrucción completa para un guion. Exportada para los tests. */
export function scriptPrompt(o: { idea: string; kind: ScriptKind; length: ScriptLength; engine: SynthSpec['engine'] | 'system'; lang?: string; styleHint?: string }): string {
  return [
    `Escribe un guion de tipo «${KIND_LABEL[o.kind]}». ${KIND_GUIDE[o.kind]}`,
    `Idioma: ${o.lang && o.lang !== 'es' ? o.lang : 'español neutro'}.`,
    `Extensión: ${WORDS[o.length]}.`,
    o.styleHint ? `Lo leerá una voz con este carácter: ${o.styleHint}` : '',
    allowedMarkup(o.engine),
    `Idea de la persona:\n«${o.idea.trim()}»`,
    'Devuelve también un título breve (máx. 4 palabras) para la pista.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título breve de la pista, máximo 4 palabras.' },
    script: { type: 'string', description: 'El texto exacto que se recitará, con las marcas permitidas.' },
  },
  required: ['title', 'script'],
};

/** Quita lo que la voz leería mal: emojis, markdown, etiquetas no permitidas, comillas envolventes. */
export function sanitizeScript(text: string, engine: SynthSpec['engine'] | 'system'): string {
  const allowed =
    engine === 'supertonic'
      ? ['breath', 'sigh', 'laugh']
      : engine === 'gemini' || engine === 'openai'
        ? ['whispers', 'breath', 'sigh', 'yawn', 'laugh', 'gasp', 'short pause', 'long pause']
        : [];
  return text
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_#`~]+/g, '')
    // Emojis completos, incluidas secuencias (banderas, 🏴‍☠️): pictogramas, uniones y selectores.
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}\u200D\uFE0F]/gu, '')
    .replace(/<([^<>]{1,24})>/g, (_m, t: string) => (allowed.includes(t.trim().toLowerCase()) ? `<${t.trim().toLowerCase()}>` : ''))
    .replace(/\[pausa\s*(\d+(?:[.,]\d+)?)?\s*s?\]/gi, (_, n) => (n ? `[pausa ${Math.min(4, Math.max(1, Number(n.replace(',', '.'))))}]` : '[pausa]'))
    .replace(/^\s*["«“]|["»”]\s*$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJson<T>(raw: string): T {
  const clean = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error('Google devolvió una respuesta incompleta. Prueba de nuevo.');
  }
}

export async function writeScript(o: {
  idea: string;
  kind: ScriptKind;
  length: ScriptLength;
  engine: SynthSpec['engine'] | 'system';
  lang?: string;
  styleHint?: string;
}): Promise<{ title: string; script: string }> {
  if (!o.idea.trim()) throw new Error('Cuéntale a la IA de qué quieres el guion');
  const data = await geminiRequest(
    {
      model: TEXT_MODEL,
      system_instruction: SYSTEM,
      input: scriptPrompt(o),
      response_format: { type: 'text', mime_type: 'application/json', schema: SCRIPT_SCHEMA },
      generation_config: { temperature: 1, thinking_level: 'low' },
    },
    'Añade tu clave gratuita de Google AI Studio para escribir con IA',
  );
  const out = parseJson<{ title?: string; script?: string }>(extractText(data));
  const script = sanitizeScript(out.script ?? '', o.engine);
  if (!script) throw new Error('La IA no devolvió texto. Prueba a describir la idea de otra forma.');
  return { title: (out.title ?? '').trim().slice(0, 40), script };
}

// ── Objetivo completo ──

const GOAL_GUIDE: Record<Goal, string> = {
  dream:
    'Objetivo «Soñar con algo». Crea 2 pistas: (1) «… · al dormirme», 80-120 palabras: la escena con los cinco sentidos, en segunda persona y presente, terminando con la intención de soñarla esta noche; (2) «… · ¿estás soñando?», 12-25 palabras: recordatorio muy breve de la escena que termina exactamente con la pregunta «¿Estás soñando?» (suena en el REM). «notes» es la intención en primera persona (1-2 frases).',
  mantra:
    'Objetivo «Mantra / afirmación». Crea 1 o 2 pistas de 20-50 palabras con afirmaciones en primera persona y presente, positivas y repetibles. «notes» es el mantra principal en una frase.',
  review:
    'Objetivo «Repasar un tema» (reactivación de la memoria). A partir de los apuntes, crea en «notes» entre 4 y 10 tarjetas de estudio separadas por una línea en blanco, cada una «concepto — explicación breve», usando SOLO información de los apuntes. Crea 1 pista con las palabras clave de las tarjetas separadas por [pausa 2] (sin explicaciones).',
};

const OBJECTIVE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Nombre corto del objetivo (máx. 5 palabras).' },
    icon: { type: 'string', description: 'Un solo emoji que lo represente.' },
    blurb: { type: 'string', description: 'Descripción de una frase.' },
    notes: { type: 'string' },
    styleId: { type: 'string', enum: VOICE_STYLES.map((s) => s.id) },
    cue: { type: 'string', enum: [...CUE_SOUNDS.map((c) => c.id), 'none'], description: 'Sonido firma que encaje con la temática.' },
    noise: { type: 'string', enum: NOISE_TYPES.filter((n) => n.id !== 'none').map((n) => n.id) },
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, text: { type: 'string' } },
        required: ['name', 'text'],
      },
    },
  },
  required: ['name', 'icon', 'blurb', 'notes', 'styleId', 'cue', 'noise', 'tracks'],
};

export function objectivePrompt(goal: Goal, idea: string): string {
  const styles = VOICE_STYLES.map((s) => `${s.id} (${s.label}: ${s.blurb})`).join('; ');
  const cues = CUE_SOUNDS.map((c) => `${c.id} (${c.label})`).join('; ');
  return [
    GOAL_GUIDE[goal],
    `Elige el estilo de voz que mejor encaje entre: ${styles}.`,
    `Elige la señal sonora entre: ${cues}; o «none» si es un mantra.`,
    'Elige el ruido de fondo: pink (rosa, neutro), brown (grave), ocean (oleaje), white (blanco).',
    allowedMarkup('supertonic'),
    goal === 'review' ? `Apuntes de la persona:\n«${idea.trim()}»` : `Idea de la persona:\n«${idea.trim()}»`,
  ].join('\n');
}

type RawObjective = {
  name?: string;
  icon?: string;
  blurb?: string;
  notes?: string;
  styleId?: string;
  cue?: string;
  noise?: string;
  tracks?: Array<{ name?: string; text?: string }>;
};

/** Convierte la respuesta en una plantilla válida (valores fuera de lista → los de por defecto). */
export function toTemplate(goal: Goal, raw: RawObjective): Template {
  const styleId = VOICE_STYLES.some((s) => s.id === raw.styleId) ? raw.styleId! : goal === 'dream' ? 'cuento' : goal === 'mantra' ? 'susurro' : 'profesor';
  const cue: CueSoundId | null = CUE_SOUNDS.some((c) => c.id === raw.cue) ? (raw.cue as CueSoundId) : goal === 'mantra' ? null : 'cuenco';
  const noise: NoiseType = NOISE_TYPES.some((n) => n.id === raw.noise && n.id !== 'none') ? (raw.noise as NoiseType) : 'pink';
  const tracks = (raw.tracks ?? [])
    .map((t, i) => ({ name: (t.name ?? '').trim().slice(0, 40) || `Pista ${i + 1}`, text: sanitizeScript(t.text ?? '', 'supertonic') }))
    .filter((t) => t.text)
    .slice(0, 3);
  if (!tracks.length) throw new Error('La IA no devolvió guiones. Prueba de nuevo.');
  const icon = [...(raw.icon ?? '').trim()].slice(0, 2).join('') || (goal === 'dream' ? '🌙' : goal === 'mantra' ? '🕯️' : '📚');
  return {
    id: `ai-${uid()}`,
    icon,
    name: (raw.name ?? '').trim().slice(0, 40) || 'Mi objetivo',
    goal,
    blurb: (raw.blurb ?? '').trim().slice(0, 160),
    cue,
    styleId,
    noise,
    notes: (raw.notes ?? '').trim(),
    tracks,
  };
}

export async function writeObjective(goal: Goal, idea: string): Promise<Template> {
  if (!idea.trim()) throw new Error(goal === 'review' ? 'Pega tus apuntes para crear el repaso' : 'Describe tu idea');
  const data = await geminiRequest(
    {
      model: TEXT_MODEL,
      system_instruction: SYSTEM,
      input: objectivePrompt(goal, idea),
      response_format: { type: 'text', mime_type: 'application/json', schema: OBJECTIVE_SCHEMA },
      generation_config: { temperature: goal === 'review' ? 0.4 : 1, thinking_level: 'low' },
    },
    'Añade tu clave gratuita de Google AI Studio para crear con IA',
  );
  return toTemplate(goal, parseJson<RawObjective>(extractText(data)));
}
