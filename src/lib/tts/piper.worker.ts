/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';

/**
 * Síntesis neuronal Piper (VITS) dentro de un Web Worker para no congelar la
 * interfaz. A diferencia de las librerías existentes, aquí se exponen los tres
 * parámetros del modelo: noise_scale (expresividad), length_scale (velocidad)
 * y noise_w (variación del ritmo).
 */

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map: Record<string, number>;
}

type PhonemizeFactory = (opts: Record<string, unknown>) => Promise<{ callMain: (args: string[]) => void }>;

export type WorkerRequest =
  | {
      id: number;
      type: 'init';
      voiceId: string;
      model: ArrayBuffer;
      config: PiperConfig;
      phonemizeJs: string;
      phonemizeWasm: ArrayBuffer;
      phonemizeData: ArrayBuffer;
    }
  | {
      id: number;
      type: 'synth';
      text: string;
      noiseScale: number;
      lengthScale: number;
      noiseW: number;
      speakerId: number;
    };

export type WorkerResponse = { id: number; error?: string; pcm?: Float32Array; sampleRate?: number };

let session: ort.InferenceSession | null = null;
let config: PiperConfig | null = null;
let voiceId = '';
let createPhonemize: PhonemizeFactory | null = null;
let phonemizeWasm: ArrayBuffer | null = null;
let phonemizeData: ArrayBuffer | null = null;

async function phonemize(text: string): Promise<number[]> {
  const factory = createPhonemize;
  if (!factory || !config) throw new Error('Motor no inicializado');
  return new Promise((resolve, reject) => {
    let done = false;
    void factory({
      noInitialRun: true,
      // Copias: el módulo se queda con los buffers que recibe.
      wasmBinary: phonemizeWasm!.slice(0),
      getPreloadedPackage: () => phonemizeData!.slice(0),
      locateFile: (f: string) => f,
      print: (out: string) => {
        if (done) return;
        done = true;
        try {
          resolve(JSON.parse(out).phoneme_ids as number[]);
        } catch (e) {
          reject(e);
        }
      },
      printErr: (msg: string) => {
        if (/error/i.test(msg) && !done) {
          done = true;
          reject(new Error(msg));
        }
      },
    })
      .then((mod) => {
        mod.callMain(['-l', config!.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        if (!done) {
          done = true;
          reject(new Error('El fonemizador no devolvió resultado'));
        }
      })
      .catch(reject);
  });
}

async function handle(msg: WorkerRequest): Promise<WorkerResponse> {
  if (msg.type === 'init') {
    if (!createPhonemize) {
      // El fonemizador (eSpeak NG, GPL) se descarga en el dispositivo; se carga como módulo.
      const src = `${msg.phonemizeJs}\nexport default createPiperPhonemize;`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      createPhonemize = (await import(/* @vite-ignore */ url)).default as PhonemizeFactory;
      URL.revokeObjectURL(url);
      phonemizeWasm = msg.phonemizeWasm;
      phonemizeData = msg.phonemizeData;
    }
    if (voiceId !== msg.voiceId || !session) {
      ort.env.wasm.numThreads = 1;
      await session?.release();
      session = await ort.InferenceSession.create(new Uint8Array(msg.model), { executionProviders: ['wasm'] });
      config = msg.config;
      voiceId = msg.voiceId;
    }
    return { id: msg.id, sampleRate: config!.audio.sample_rate };
  }

  if (!session || !config) throw new Error('Motor no inicializado');
  const ids = await phonemize(msg.text);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([msg.noiseScale, msg.lengthScale, msg.noiseW]), [3]),
  };
  if (Object.keys(config.speaker_id_map ?? {}).length) {
    feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(msg.speakerId)]), [1]);
  }
  const out = await session.run(feeds);
  const pcm = new Float32Array(out.output.data as Float32Array);
  return { id: msg.id, pcm, sampleRate: config.audio.sample_rate };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const res = await handle(e.data);
    (self as unknown as Worker).postMessage(res, res.pcm ? [res.pcm.buffer] : []);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: (err as Error).message ?? String(err) });
  }
};
