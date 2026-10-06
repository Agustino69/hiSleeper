import { normalizeBuffer } from '../audio/synth';
import type { SynthSpec } from '../types';
import { openaiSynth } from './openai';
import { piperSynth, type PiperParams } from './piper';

/**
 * Generación de voz: texto → frases con pausas → síntesis → posproducción
 * (tono, calidez, eco) → AudioBuffer normalizado.
 */

export interface ScriptPart {
  text: string;
  /** Segundos de silencio después de esta frase. */
  pauseAfter: number;
}

/**
 * Divide el guion en frases. Marcas admitidas:
 *  - «...» o «…» al final de una frase: pausa larga.
 *  - Línea en blanco: pausa de párrafo.
 *  - [pausa] o [pausa 3]: silencio explícito (segundos).
 */
export function splitScript(text: string, basePause: number): ScriptPart[] {
  const parts: ScriptPart[] = [];
  const addPause = (s: number) => {
    if (parts.length) parts[parts.length - 1].pauseAfter += s;
  };
  const paragraphs = text.replace(/\r/g, '').split(/\n\s*\n/);
  paragraphs.forEach((para, pi) => {
    if (pi > 0) addPause(basePause * 1.5 + 0.4);
    const tokens = para.split(/(\[pausa(?:\s+[\d.,]+)?\s*s?\])/i);
    for (const tok of tokens) {
      const m = /^\[pausa(?:\s+([\d.,]+))?\s*s?\]$/i.exec(tok);
      if (m) {
        addPause(m[1] ? Number(m[1].replace(',', '.')) || 1 : 1.5);
        continue;
      }
      const sentences = tok.match(/[^.!?…\n]+(?:\.\.\.|[.!?…]+)?/g) ?? [];
      for (const raw of sentences) {
        const s = raw.trim();
        if (!/[\p{L}\p{N}]/u.test(s)) continue;
        const long = /(\.\.\.|…)$/.test(s);
        parts.push({ text: s.replace(/(\.\.\.|…)$/, '.'), pauseAfter: basePause * (long ? 2.2 : 1) });
      }
    }
  });
  if (parts.length) parts[parts.length - 1].pauseAfter = 0;
  return parts;
}

/** Factor de remuestreo para subir/bajar el tono (semitonos). */
export const pitchRate = (semitones: number) => Math.pow(2, semitones / 12);

export function piperParams(spec: SynthSpec): PiperParams {
  return {
    noiseScale: 0.3 + 0.7 * (spec.expressiveness / 100),
    // Se alarga de antemano lo que el cambio de tono va a acortar (y viceversa),
    // así el tono cambia sin cambiar la velocidad.
    lengthScale: (1 / spec.speed) * pitchRate(spec.pitch),
    noiseW: 0.2 + 1.0 * (spec.rhythm / 100),
  };
}

export type RenderProgress = (done: number, total: number) => void;

export async function renderVoice(text: string, spec: SynthSpec, onProgress?: RenderProgress): Promise<AudioBuffer> {
  if (spec.engine === 'openai') {
    onProgress?.(0, 1);
    const buf = await openaiSynth(text, spec);
    onProgress?.(1, 1);
    return postProcess([{ pcm: buf.getChannelData(0), sampleRate: buf.sampleRate, pauseAfter: 0 }], { ...spec, pitch: 0 });
  }
  const parts = splitScript(text, spec.pause);
  if (!parts.length) throw new Error('Escribe algún texto');
  const params = piperParams(spec);
  const segments: Array<{ pcm: Float32Array; sampleRate: number; pauseAfter: number }> = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress?.(i, parts.length);
    const { pcm, sampleRate } = await piperSynth(spec.voice, parts[i].text, params);
    segments.push({ pcm, sampleRate, pauseAfter: parts[i].pauseAfter });
  }
  onProgress?.(parts.length, parts.length);
  return postProcess(segments, spec);
}

async function postProcess(
  segments: Array<{ pcm: Float32Array; sampleRate: number; pauseAfter: number }>,
  spec: SynthSpec,
): Promise<AudioBuffer> {
  const sr = segments[0].sampleRate;
  const lead = Math.round(0.2 * sr);
  const len = lead + segments.reduce((a, s) => a + s.pcm.length + Math.round(s.pauseAfter * sr), 0);
  const raw = new Float32Array(len);
  let off = lead;
  for (const s of segments) {
    raw.set(s.pcm, off);
    off += s.pcm.length + Math.round(s.pauseAfter * sr);
  }

  const rate = pitchRate(spec.pitch);
  const w = spec.warmth / 100;
  const r = spec.reverb / 100;
  const tail = r > 0 ? 0.4 + 2.6 * r : 0.1;
  const outRate = 24000; // suficiente para voz y archivos más ligeros
  const outLen = Math.ceil((len / sr / rate + tail) * outRate);
  const ctx = new OfflineAudioContext(1, outLen, outRate);

  const input = ctx.createBuffer(1, len, sr);
  input.copyToChannel(raw, 0);
  const src = ctx.createBufferSource();
  src.buffer = input;
  src.playbackRate.value = rate;

  // Calidez: más cuerpo en graves, menos brillo y sibilancia.
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 250;
  low.gain.value = 4 * w;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 3500;
  high.gain.value = -10 * w;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 12000 - 7000 * w;
  src.connect(low).connect(high).connect(lp);

  const dry = ctx.createGain();
  dry.gain.value = 1 - 0.35 * r;
  lp.connect(dry).connect(ctx.destination);
  if (r > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, tail, 2 + 2 * (1 - r));
    const wet = ctx.createGain();
    wet.gain.value = 0.55 * r;
    lp.connect(conv).connect(wet).connect(ctx.destination);
  }
  src.start();
  return normalizeBuffer(await ctx.startRendering(), 0.1);
}

/** Respuesta al impulso sintética: ruido con caída exponencial (sala → catedral). */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  return buf;
}

/** Codifica a WAV PCM de 16 bits para guardarlo como pista. */
export function encodeWav(buf: AudioBuffer): Blob {
  const data = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
