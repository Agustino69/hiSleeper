import { registerPlugin } from '@capacitor/core';
import { db } from '../db';
import { isNative } from '../native';
import { fetchAsset, hasAsset, type Progress } from './assets';
import { textToIds } from './supertonicText';
import type { StyleData, SupertonicRequest, SupertonicResponse } from './supertonic.worker';

/**
 * Supertonic 3 (Supertone): voces naturales en el dispositivo (31 idiomas, español
 * incluido), gratis y sin conexión tras una descarga. Revisiones fijadas.
 *  - App de Android: ONNX Runtime nativo con la versión int8 (102 MB, rápida en ARM).
 *  - Navegador: onnxruntime-web con la versión original fp32 (398 MB): el int8
 *    es muy lento en WebAssembly.
 */
const INT8_REPO = 'https://huggingface.co/soniqo/Supertonic-3-ONNX-INT8/resolve/11f5965fd0bc7dfb191a16d83772fc658a3c03d8';
const FP32_REPO = 'https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323';

interface SupertonicNative {
  status(): Promise<{ ready: boolean; downloading: boolean }>;
  download(o: { baseUrl: string }): Promise<void>;
  remove(): Promise<void>;
  synth(o: {
    ids: number[];
    ttl: string;
    ttlDims: number[];
    dp: string;
    dpDims: number[];
    steps: number;
    speed: number;
    temperature: number;
    config: { sampleRate: number; baseChunkSize: number; chunkCompress: number; latentDim: number };
  }): Promise<{ pcm: string; sampleRate: number }>;
  addListener(e: 'progress', cb: (p: { loaded: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
const Native = registerPlugin<SupertonicNative>('Supertonic');

export interface SupertonicVoice {
  /** "st:F1" */
  id: string;
  style: string;
  label: string;
  gender: 'f' | 'm';
}

// Etiquetas según el tono medido de cada voz (de más aguda a más grave).
export const SUPERTONIC_VOICES: SupertonicVoice[] = [
  { id: 'st:F1', style: 'F1', label: 'Mujer 1', gender: 'f' },
  { id: 'st:F2', style: 'F2', label: 'Mujer 2', gender: 'f' },
  { id: 'st:F3', style: 'F3', label: 'Mujer 3', gender: 'f' },
  { id: 'st:F4', style: 'F4', label: 'Mujer 4', gender: 'f' },
  { id: 'st:F5', style: 'F5', label: 'Mujer 5', gender: 'f' },
  { id: 'st:M1', style: 'M1', label: 'Hombre 1', gender: 'm' },
  { id: 'st:M2', style: 'M2', label: 'Hombre 2', gender: 'm' },
  { id: 'st:M3', style: 'M3', label: 'Hombre 3', gender: 'm' },
  { id: 'st:M4', style: 'M4', label: 'Hombre 4', gender: 'm' },
  { id: 'st:M5', style: 'M5', label: 'Hombre 5', gender: 'm' },
];

export const isSupertonicVoice = (id: string) => id.startsWith('st:');
export const supertonicVoice = (id: string) => SUPERTONIC_VOICES.find((v) => v.id === id) ?? SUPERTONIC_VOICES[0];

export const SUPERTONIC_SIZE_MB = isNative ? 105 : 400;

/** Archivos pequeños (configuración y voces): en IndexedDB en ambas plataformas. */
const SMALL_ASSETS = [
  { key: 'st:tts.json', url: `${INT8_REPO}/onnx/tts.json` },
  { key: 'st:indexer.json', url: `${INT8_REPO}/onnx/unicode_indexer.json` },
  ...SUPERTONIC_VOICES.map((v) => ({ key: `st:style:${v.style}`, url: `${INT8_REPO}/voice_styles/${v.style}.json` })),
];

/** Modelos ONNX para el navegador (en Android los descarga el plugin nativo). */
const WEB_MODELS = [
  { key: 'st:dp', url: `${FP32_REPO}/onnx/duration_predictor.onnx` },
  { key: 'st:enc', url: `${FP32_REPO}/onnx/text_encoder.onnx` },
  { key: 'st:vec', url: `${FP32_REPO}/onnx/vector_estimator.onnx` },
  { key: 'st:voc', url: `${FP32_REPO}/onnx/vocoder.onnx` },
];

export async function isSupertonicReady(): Promise<boolean> {
  const small = (await Promise.all(SMALL_ASSETS.map((a) => hasAsset(a.key)))).every(Boolean);
  if (!small) return false;
  if (isNative) return (await Native.status().catch(() => ({ ready: false }))).ready;
  return (await Promise.all(WEB_MODELS.map((a) => hasAsset(a.key)))).every(Boolean);
}

export async function downloadSupertonic(onProgress?: Progress): Promise<void> {
  const loaded = new Map<string, number>();
  const expected = SUPERTONIC_SIZE_MB * 1e6;
  const report = (k: string, l: number) => {
    loaded.set(k, l);
    const sum = [...loaded.values()].reduce((x, y) => x + y, 0);
    onProgress?.(sum, Math.max(expected, sum));
  };
  const web = isNative ? [] : WEB_MODELS;
  const files = Promise.all([...SMALL_ASSETS, ...web].map((a) => fetchAsset(a.key, a.url, (l) => report(a.key, l))));
  if (isNative) {
    const sub = await Native.addListener('progress', (p) => report('native', p.loaded));
    try {
      await Promise.all([files, Native.download({ baseUrl: INT8_REPO })]);
    } finally {
      await sub.remove();
    }
  } else {
    await files;
  }
}

const asset = async (key: string) => {
  const b = await db.assets.get(key);
  if (!b) throw new Error('Las voces naturales no están descargadas');
  return b;
};

const styleCache = new Map<string, StyleData>();

async function loadStyle(name: string): Promise<StyleData> {
  let s = styleCache.get(name);
  if (!s) {
    const json = JSON.parse(await (await asset(`st:style:${name}`)).text());
    s = {
      ttl: Float32Array.from((json.style_ttl.data as unknown[]).flat(Infinity) as number[]),
      ttlDims: json.style_ttl.dims,
      dp: Float32Array.from((json.style_dp.data as unknown[]).flat(Infinity) as number[]),
      dpDims: json.style_dp.dims,
    };
    styleCache.set(name, s);
  }
  return s;
}

/** Mezcla dos voces: 0 = solo la primera, 1 = solo la segunda. Da timbres intermedios. */
export function mixStyles(a: StyleData, b: StyleData, t: number): StyleData {
  const lerp = (x: Float32Array, y: Float32Array) => x.map((v, i) => v + (y[i] - v) * t);
  return { ttl: lerp(a.ttl, b.ttl), ttlDims: a.ttlDims, dp: lerp(a.dp, b.dp), dpDims: a.dpDims };
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: SupertonicResponse) => void; reject: (e: Error) => void }>();

function call(msg: SupertonicRequest, transfer: Transferable[] = []): Promise<SupertonicResponse> {
  if (!worker) {
    worker = new Worker(new URL('./supertonic.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SupertonicResponse>) => {
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
      ready = null;
    };
  }
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    worker!.postMessage(msg, transfer);
  });
}

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const [dp, enc, vec, voc, config, indexer] = await Promise.all([
        asset('st:dp').then((b) => b.arrayBuffer()),
        asset('st:enc').then((b) => b.arrayBuffer()),
        asset('st:vec').then((b) => b.arrayBuffer()),
        asset('st:voc').then((b) => b.arrayBuffer()),
        asset('st:tts.json').then((b) => b.text()).then(JSON.parse),
        asset('st:indexer.json').then((b) => b.text()).then(JSON.parse),
      ]);
      await call({ id: ++seq, type: 'init', models: { dp, enc, vec, voc }, config, indexer }, [dp, enc, vec, voc]);
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

export interface SupertonicParams {
  voice: string;
  /** Segunda voz para mezclar (opcional) y proporción 0-1. */
  mixWith?: string;
  mix?: number;
  speed: number;
  steps: number;
  temperature: number;
  lang?: string;
}

export async function supertonicSynth(text: string, p: SupertonicParams): Promise<{ pcm: Float32Array; sampleRate: number }> {
  let style = await loadStyle(supertonicVoice(p.voice).style);
  if (p.mixWith && p.mix && p.mix > 0) style = mixStyles(style, await loadStyle(supertonicVoice(p.mixWith).style), p.mix);
  if (isNative) return nativeSynth(text, p, style);
  await ensureReady();
  const res = await call({
    id: ++seq,
    type: 'synth',
    text,
    lang: p.lang ?? 'es',
    style: { ...style, ttl: style.ttl.slice(), dp: style.dp.slice() },
    steps: p.steps,
    speed: p.speed,
    temperature: p.temperature,
  });
  lastTimings = res.timings ?? null;
  return { pcm: res.pcm!, sampleRate: res.sampleRate! };
}

/** Tiempos de la última síntesis por etapa (diagnóstico). */
export let lastTimings: Record<string, number> | null = null;

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function nativeSynth(text: string, p: SupertonicParams, style: StyleData) {
  const [config, indexer] = await Promise.all([
    asset('st:tts.json').then((b) => b.text()).then(JSON.parse),
    asset('st:indexer.json').then((b) => b.text()).then(JSON.parse),
  ]);
  const res = await Native.synth({
    ids: textToIds(text, p.lang ?? 'es', indexer),
    ttl: b64(new Uint8Array(style.ttl.buffer, style.ttl.byteOffset, style.ttl.byteLength)),
    ttlDims: style.ttlDims,
    dp: b64(new Uint8Array(style.dp.buffer, style.dp.byteOffset, style.dp.byteLength)),
    dpDims: style.dpDims,
    steps: p.steps,
    speed: p.speed,
    temperature: p.temperature,
    config: {
      sampleRate: config.ae.sample_rate,
      baseChunkSize: config.ae.base_chunk_size,
      chunkCompress: config.ttl.chunk_compress_factor,
      latentDim: config.ttl.latent_dim,
    },
  });
  const bytes = Uint8Array.from(atob(res.pcm), (c) => c.charCodeAt(0));
  const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const pcm = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) pcm[i] = i16[i] / 32768;
  return { pcm, sampleRate: res.sampleRate };
}
