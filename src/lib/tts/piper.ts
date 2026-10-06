import { db } from '../db';
import { fetchAsset, hasAsset, removeAsset, type Progress } from './assets';
import type { WorkerRequest, WorkerResponse } from './piper.worker';

/** Voces neuronales Piper que corren en el propio dispositivo. */

const PHONEMIZE_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOICES_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';

export interface PiperVoice {
  /** Modelo + hablante: "es_MX-claude-high#0". */
  id: string;
  model: string;
  path: string;
  speaker: number;
  label: string;
  accent: string;
  gender: 'f' | 'm';
  sizeMb: number;
}

const v = (model: string, path: string, label: string, accent: string, gender: 'f' | 'm', sizeMb: number, speaker = 0): PiperVoice => ({
  id: `${model}#${speaker}`,
  model,
  path,
  speaker,
  label,
  accent,
  gender,
  sizeMb,
});

// Género verificado midiendo el tono fundamental de cada modelo.
export const PIPER_VOICES: PiperVoice[] = [
  v('es_MX-claude-high', 'es/es_MX/claude/high', 'Mujer · alta calidad', 'México', 'f', 63),
  v('es_MX-ald-medium', 'es/es_MX/ald/medium', 'Hombre', 'México', 'm', 63),
  v('es_ES-davefx-medium', 'es/es_ES/davefx/medium', 'Hombre · grave', 'España', 'm', 63),
  v('es_ES-sharvard-medium', 'es/es_ES/sharvard/medium', 'Mujer', 'España', 'f', 77, 1),
  v('es_ES-sharvard-medium', 'es/es_ES/sharvard/medium', 'Hombre', 'España', 'm', 77, 0),
  v('en_US-amy-medium', 'en/en_US/amy/medium', 'Mujer · inglés', 'EE. UU.', 'f', 63),
  v('en_US-ryan-medium', 'en/en_US/ryan/medium', 'Hombre · inglés', 'EE. UU.', 'm', 63),
];

export const DEFAULT_PIPER_VOICE = PIPER_VOICES[0].id;

export function piperVoice(id: string): PiperVoice {
  return PIPER_VOICES.find((x) => x.id === id) ?? PIPER_VOICES[0];
}

// El motor ONNX va dentro de la app; aquí solo el fonemizador (eSpeak NG, GPL),
// que se descarga al dispositivo en lugar de distribuirse con el código.
const ENGINE_ASSETS = [
  { key: 'phonemize.js', url: `${PHONEMIZE_BASE}.js` },
  { key: 'phonemize.wasm', url: `${PHONEMIZE_BASE}.wasm` },
  { key: 'phonemize.data', url: `${PHONEMIZE_BASE}.data` },
];
/** Tamaño aproximado del motor compartido por todas las voces. */
export const ENGINE_SIZE_MB = 19;

const modelAssets = (voice: PiperVoice) => [
  { key: `piper:${voice.model}.onnx`, url: `${VOICES_BASE}/${voice.path}/${voice.model}.onnx` },
  { key: `piper:${voice.model}.json`, url: `${VOICES_BASE}/${voice.path}/${voice.model}.onnx.json` },
];

export async function isEngineReady(): Promise<boolean> {
  return (await Promise.all(ENGINE_ASSETS.map((a) => hasAsset(a.key)))).every(Boolean);
}

export async function isVoiceReady(id: string): Promise<boolean> {
  const assets = modelAssets(piperVoice(id));
  return (await Promise.all(assets.map((a) => hasAsset(a.key)))).every(Boolean);
}

/** Descarga el motor (si falta) y la voz, informando del progreso combinado. */
export async function downloadVoice(id: string, onProgress?: Progress): Promise<void> {
  const voice = piperVoice(id);
  const all = [...ENGINE_ASSETS, ...modelAssets(voice)];
  const loaded = new Map<string, number>();
  const totals = new Map<string, number>();
  const expected = (ENGINE_SIZE_MB + voice.sizeMb) * 1e6;
  const report = () => {
    const l = [...loaded.values()].reduce((a, b) => a + b, 0);
    const t = Math.max(expected, [...totals.values()].reduce((a, b) => a + b, 0));
    onProgress?.(l, t);
  };
  await Promise.all(
    all.map((a) =>
      fetchAsset(a.key, a.url, (l, t) => {
        loaded.set(a.key, l);
        totals.set(a.key, t);
        report();
      }),
    ),
  );
}

export async function deleteVoice(id: string) {
  for (const a of modelAssets(piperVoice(id))) await removeAsset(a.key);
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
let loadedModel: string | null = null;

function call(msg: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
  if (!worker) {
    worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Error en el motor de voz'));
      pending.clear();
      worker = null;
      loadedModel = null;
    };
  }
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    worker!.postMessage(msg, transfer);
  });
}

async function ensureLoaded(voice: PiperVoice): Promise<number> {
  if (loadedModel === voice.model) return 0;
  const get = async (key: string) => {
    const b = await db.assets.get(key);
    if (!b) throw new Error('La voz no está descargada');
    return b;
  };
  const [model, config, phonemizeJs, phonemizeWasm, phonemizeData] = await Promise.all([
    get(`piper:${voice.model}.onnx`).then((b) => b.arrayBuffer()),
    get(`piper:${voice.model}.json`).then((b) => b.text()).then((t) => JSON.parse(t)),
    get('phonemize.js').then((b) => b.text()),
    get('phonemize.wasm').then((b) => b.arrayBuffer()),
    get('phonemize.data').then((b) => b.arrayBuffer()),
  ]);
  const res = await call(
    { id: ++seq, type: 'init', voiceId: voice.model, model, config, phonemizeJs, phonemizeWasm, phonemizeData },
    [model, phonemizeWasm, phonemizeData],
  );
  loadedModel = voice.model;
  return res.sampleRate ?? 22050;
}

export interface PiperParams {
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
}

/** Sintetiza una frase y devuelve las muestras PCM. */
export async function piperSynth(voiceId: string, text: string, p: PiperParams): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const voice = piperVoice(voiceId);
  await ensureLoaded(voice);
  const res = await call({ id: ++seq, type: 'synth', text, speakerId: voice.speaker, ...p });
  return { pcm: res.pcm!, sampleRate: res.sampleRate! };
}
