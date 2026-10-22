/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { textToIds } from './supertonicText';

/**
 * Supertonic 3 (Supertone, modelo OpenRAIL-M) en un Web Worker.
 * Pipeline de flujo no autorregresivo: duración → codificador de texto →
 * estimador vectorial ×N pasos → vocoder. Adaptado del ejemplo web oficial
 * (MIT, github.com/supertone-inc/supertonic) usando arrays tipados.
 */

interface TtsConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

export interface StyleData {
  ttl: Float32Array;
  ttlDims: number[];
  dp: Float32Array;
  dpDims: number[];
}

export type SupertonicRequest =
  | {
      id: number;
      type: 'init';
      models: { dp: ArrayBuffer; enc: ArrayBuffer; vec: ArrayBuffer; voc: ArrayBuffer };
      config: TtsConfig;
      indexer: number[];
    }
  | {
      id: number;
      type: 'synth';
      text: string;
      lang: string;
      style: StyleData;
      steps: number;
      speed: number;
      /** Escala del ruido inicial: más alto = más variación en la entonación. */
      temperature: number;
    };

export type SupertonicResponse = { id: number; error?: string; pcm?: Float32Array; sampleRate?: number; timings?: Record<string, number> };

let sessions: { dp: ort.InferenceSession; enc: ort.InferenceSession; vec: ort.InferenceSession; voc: ort.InferenceSession } | null = null;
let cfg: TtsConfig | null = null;
let indexer: number[] = [];

function gaussian(): number {
  const u1 = Math.max(0.0001, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

async function synth(req: Extract<SupertonicRequest, { type: 'synth' }>): Promise<SupertonicResponse> {
  if (!sessions || !cfg) throw new Error('Motor no inicializado');
  const idList = textToIds(req.text, req.lang, indexer);
  const n = idList.length;
  const ids = BigInt64Array.from(idList.map(BigInt));
  const textIds = new ort.Tensor('int64', ids, [1, n]);
  const textMask = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]);
  const styleTtl = new ort.Tensor('float32', req.style.ttl, req.style.ttlDims);
  const styleDp = new ort.Tensor('float32', req.style.dp, req.style.dpDims);

  const tm: Record<string, number> = {};
  let t = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    tm[k] = Math.round(n - t);
    t = n;
  };
  const dpOut = await sessions.dp.run({ text_ids: textIds, style_dp: styleDp, text_mask: textMask });
  const duration = (dpOut.duration.data as Float32Array)[0] / req.speed;
  lap('duration');
  const encOut = await sessions.enc.run({ text_ids: textIds, style_ttl: styleTtl, text_mask: textMask });
  lap('encoder');

  const sr = cfg.ae.sample_rate;
  const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const latentLen = Math.max(1, Math.floor((Math.floor(duration * sr) + chunk - 1) / chunk));
  const latentDim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  let xt = new Float32Array(latentDim * latentLen);
  for (let i = 0; i < xt.length; i++) xt[i] = gaussian() * req.temperature;
  const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
  const total = new ort.Tensor('float32', new Float32Array([req.steps]), [1]);

  for (let step = 0; step < req.steps; step++) {
    const out = await sessions.vec.run({
      noisy_latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]),
      text_emb: encOut.text_emb,
      style_ttl: styleTtl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
      total_step: total,
    });
    xt = new Float32Array(out.denoised_latent.data as Float32Array);
  }
  lap('steps');
  const voc = await sessions.voc.run({ latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]) });
  lap('vocoder');
  const wav = voc.wav_tts.data as Float32Array;
  // El vocoder rellena hasta el final del bloque: se recorta a la duración prevista.
  const len = Math.min(wav.length, Math.ceil(duration * sr));
  return { id: req.id, pcm: wav.slice(0, len), sampleRate: sr, timings: tm };
}

async function handle(msg: SupertonicRequest): Promise<SupertonicResponse> {
  if (msg.type === 'init') {
    if (!sessions) {
      ort.env.wasm.numThreads = 1;
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const load = (b: ArrayBuffer) => ort.InferenceSession.create(new Uint8Array(b), opts);
      sessions = {
        dp: await load(msg.models.dp),
        enc: await load(msg.models.enc),
        vec: await load(msg.models.vec),
        voc: await load(msg.models.voc),
      };
      cfg = msg.config;
      indexer = msg.indexer;
    }
    return { id: msg.id, sampleRate: cfg!.ae.sample_rate };
  }
  return synth(msg);
}

self.onmessage = async (e: MessageEvent<SupertonicRequest>) => {
  try {
    const res = await handle(e.data);
    (self as unknown as Worker).postMessage(res, res.pcm ? [res.pcm.buffer] : []);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: (err as Error).message ?? String(err) });
  }
};
