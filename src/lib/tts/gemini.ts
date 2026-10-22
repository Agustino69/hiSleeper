import { db } from '../db';
import type { SynthSpec } from '../types';

/**
 * Voz en la nube de Google (Gemini 3.8 Flash TTS): actúa según indicaciones en
 * lenguaje natural y entiende etiquetas como <whispers>, <sigh> o <yawn>.
 * Gratis con una clave de Google AI Studio (sin tarjeta), con límites de uso.
 * La clave se guarda solo en este dispositivo.
 */

export const GEMINI_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

export const GEMINI_VOICES: Array<{ id: string; label: string }> = [
  { id: 'Sulafat', label: 'Sulafat · cálida' },
  { id: 'Achernar', label: 'Achernar · suave' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix · tierna' },
  { id: 'Enceladus', label: 'Enceladus · aireada' },
  { id: 'Despina', label: 'Despina · aterciopelada' },
  { id: 'Algieba', label: 'Algieba · aterciopelado' },
  { id: 'Gacrux', label: 'Gacrux · madura' },
  { id: 'Algenib', label: 'Algenib · ronco' },
  { id: 'Charon', label: 'Charon · narrador' },
  { id: 'Iapetus', label: 'Iapetus · claro' },
  { id: 'Kore', label: 'Kore · firme' },
  { id: 'Orus', label: 'Orus · firme' },
  { id: 'Fenrir', label: 'Fenrir · enérgico' },
  { id: 'Puck', label: 'Puck · alegre' },
  { id: 'Aoede', label: 'Aoede · ligera' },
  { id: 'Leda', label: 'Leda · juvenil' },
  { id: 'Zephyr', label: 'Zephyr · brillante' },
  { id: 'Achird', label: 'Achird · amable' },
  { id: 'Schedar', label: 'Schedar · serena' },
  { id: 'Umbriel', label: 'Umbriel · relajado' },
];

/** Etiquetas expresivas que entiende la voz en la nube. */
export const GEMINI_TAGS = ['<whispers>', '<sigh>', '<breath>', '<laugh>', '<yawn>', '<gasp>', '<short pause>', '<long pause>'];

const KEY = 'geminiKey';
export const getGeminiKey = () => db.meta.get<string>(KEY);
export const setGeminiKey = (k: string) => (k ? db.meta.set(KEY, k.trim()) : db.meta.remove(KEY));

/** Traduce los controles a indicaciones de actuación. */
export function buildStyle(spec: SynthSpec): string {
  const pace =
    spec.speed < 0.75 ? 'muy despacio, sin prisa' : spec.speed < 0.92 ? 'despacio y con calma' : spec.speed > 1.15 ? 'con ritmo ágil' : 'a ritmo natural';
  const expr =
    spec.expressiveness < 30
      ? 'entonación serena y uniforme'
      : spec.expressiveness > 70
        ? 'mucha expresividad, emoción y matices'
        : 'expresividad natural';
  const rhythm = spec.rhythm > 70 ? 'Varía el ritmo como al contar una historia.' : spec.rhythm < 30 ? 'Ritmo regular, casi hipnótico.' : '';
  return [
    spec.instructions?.trim(),
    `Habla${spec.lang && spec.lang !== 'es' ? '' : ' en español'}, ${pace}, con ${expr}. ${rhythm}`,
    'Volumen íntimo y suave: quien escucha se está quedando dormido.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Convierte las marcas del guion a las de Gemini. */
export function toGeminiText(text: string): string {
  return text
    .replace(/\[pausa(?:\s+([\d.,]+))?\s*s?\]/gi, (_, n) => (n && Number(n.replace(',', '.')) < 1.5 ? '<short pause>' : '<long pause>'))
    .replace(/(\.\.\.|…)/g, '... <short pause>')
    .trim();
}

export async function geminiSynth(text: string, spec: SynthSpec): Promise<AudioBuffer> {
  const key = await getGeminiKey();
  if (!key) throw new Error('Añade tu clave gratuita de Google AI Studio para usar la voz en la nube');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text: toGeminiText(text), annotations: [{ type: 'speech_metadata', style: buildStyle(spec) }] }],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: spec.voice }] },
    }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error?.message ?? msg;
    } catch {
      /* sin JSON */
    }
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Clave de Google AI Studio no válida');
    if (res.status === 429) throw new Error('Llegaste al límite gratuito de Google por ahora. Prueba en un rato o usa la voz del teléfono.');
    throw new Error(`Google: ${msg}`);
  }
  const data = await res.json();
  const audio = extractAudio(data);
  if (!audio) throw new Error('Google no devolvió audio');
  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  return decodeAudio(bytes, audio.mimeType);
}

/** Último bloque de audio de la respuesta (steps[].content[] con type "audio"). */
export function extractAudio(data: unknown): { data: string; mimeType?: string } | null {
  const steps = (data as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }> }).steps ?? [];
  const parts = steps.filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio' && c.data);
  const last = parts[parts.length - 1];
  return last ? { data: last.data!, mimeType: last.mime_type } : null;
}

async function decodeAudio(bytes: Uint8Array, mimeType?: string): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 24000);
  // WAV (con cabecera) por defecto; PCM L16 crudo si así lo indica.
  if (!mimeType || /wav/i.test(mimeType) || String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') {
    return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const buf = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: rate });
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  return buf;
}
