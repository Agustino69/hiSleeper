import type { CueSoundId, NoiseType } from '../types';

/**
 * Sonidos generados en el dispositivo (sin archivos externos). Todos tienen
 * ataques suaves: los transitorios bruscos son los que más despiertan.
 */

export const CUE_SOUNDS: Array<{ id: CueSoundId; label: string }> = [
  { id: 'cuenco', label: 'Cuenco tibetano' },
  { id: 'campana', label: 'Campana suave' },
  { id: 'kalimba', label: 'Kalimba' },
  { id: 'arpa', label: 'Arpa (arpegio)' },
  { id: 'flauta', label: 'Flauta' },
  { id: 'cristal', label: 'Cristal' },
  { id: 'gota', label: 'Gota de agua' },
  { id: 'madera', label: 'Madera' },
];

export const NOISE_TYPES: Array<{ id: NoiseType; label: string }> = [
  { id: 'pink', label: 'Ruido rosa' },
  { id: 'brown', label: 'Ruido marrón (grave)' },
  { id: 'ocean', label: 'Oleaje' },
  { id: 'white', label: 'Ruido blanco' },
  { id: 'none', label: 'Silencio' },
];

const SR = 44100;

function envelope(g: GainNode, t0: number, attack: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function partial(
  ctx: BaseAudioContext,
  out: AudioNode,
  freq: number,
  t0: number,
  attack: number,
  peak: number,
  decay: number,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  envelope(g, t0, attack, peak, decay);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
  return osc;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const CUE_LENGTH: Record<CueSoundId, number> = {
  cuenco: 4,
  campana: 2.6,
  kalimba: 1.6,
  arpa: 2.4,
  flauta: 1.8,
  cristal: 2.2,
  gota: 0.6,
  madera: 0.5,
};

function drawCue(ctx: OfflineAudioContext, id: CueSoundId) {
  const out = ctx.destination;
  switch (id) {
    case 'cuenco': {
      // Parciales inarmónicos con un ligero batido.
      partial(ctx, out, 196, 0, 0.12, 0.5, 3.8);
      partial(ctx, out, 197.3, 0, 0.12, 0.35, 3.8);
      partial(ctx, out, 196 * 2.72, 0, 0.1, 0.18, 2.6);
      partial(ctx, out, 196 * 5.1, 0, 0.08, 0.06, 1.4);
      break;
    }
    case 'campana': {
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const g = ctx.createGain();
      car.frequency.value = 523.25;
      mod.frequency.value = 523.25 * 1.4;
      modGain.gain.setValueAtTime(400, 0);
      modGain.gain.exponentialRampToValueAtTime(5, 2.4);
      mod.connect(modGain).connect(car.frequency);
      envelope(g, 0, 0.02, 0.6, 2.5);
      car.connect(g).connect(out);
      car.start(0);
      mod.start(0);
      car.stop(2.6);
      mod.stop(2.6);
      break;
    }
    case 'kalimba': {
      partial(ctx, out, 523.25, 0, 0.015, 0.6, 1.4);
      partial(ctx, out, 523.25 * 5.4, 0, 0.015, 0.08, 0.25);
      partial(ctx, out, 523.25 * 2, 0, 0.015, 0.1, 0.6);
      break;
    }
    case 'arpa': {
      const notes = [392, 493.88, 587.33];
      notes.forEach((f, i) => {
        const t = i * 0.28;
        partial(ctx, out, f, t, 0.015, 0.45, 1.8, 'triangle');
        partial(ctx, out, f * 2, t, 0.015, 0.1, 0.8);
      });
      break;
    }
    case 'flauta': {
      const osc = ctx.createOscillator();
      const vib = ctx.createOscillator();
      const vibGain = ctx.createGain();
      const g = ctx.createGain();
      osc.frequency.value = 587.33;
      vib.frequency.value = 5;
      vibGain.gain.value = 4;
      vib.connect(vibGain).connect(osc.frequency);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.5, 0.35);
      g.gain.setValueAtTime(0.5, 1.1);
      g.gain.linearRampToValueAtTime(0, 1.75);
      osc.connect(g).connect(out);
      // Soplo: ruido filtrado.
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx, 1.8);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 1.5;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, 0);
      bg.gain.linearRampToValueAtTime(0.05, 0.3);
      bg.gain.linearRampToValueAtTime(0, 1.7);
      breath.connect(bp).connect(bg).connect(out);
      for (const n of [osc, vib, breath]) {
        n.start(0);
        n.stop(1.8);
      }
      break;
    }
    case 'cristal': {
      partial(ctx, out, 1318.5, 0, 0.03, 0.3, 2.1);
      partial(ctx, out, 1975.5, 0.05, 0.03, 0.18, 1.8);
      partial(ctx, out, 2637, 0.1, 0.03, 0.08, 1.2);
      break;
    }
    case 'gota': {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(500, 0);
      osc.frequency.exponentialRampToValueAtTime(1500, 0.09);
      envelope(g, 0, 0.015, 0.6, 0.45);
      osc.connect(g).connect(out);
      osc.start(0);
      osc.stop(0.6);
      break;
    }
    case 'madera': {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 8;
      const g = ctx.createGain();
      envelope(g, 0, 0.012, 1.4, 0.18);
      src.connect(bp).connect(g).connect(out);
      src.start(0);
      partial(ctx, out, 820, 0, 0.012, 0.35, 0.2);
      break;
    }
  }
}

/** Escala un buffer a una sonoridad (RMS) común sin superar un pico seguro. */
export function normalizeBuffer(buf: AudioBuffer, targetRms = 0.1, maxPeak = 0.9): AudioBuffer {
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    n += d.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms === 0 || peak === 0) return buf;
  const k = Math.min(targetRms / rms, maxPeak / peak);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}

export async function renderCue(id: CueSoundId): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(CUE_LENGTH[id] * SR), SR);
  drawCue(ctx, id);
  return normalizeBuffer(await ctx.startRendering(), 0.08);
}

/**
 * Buffer de ruido que se puede repetir en bucle sin "clic": las últimas
 * muestras se funden con las primeras.
 */
export function createNoiseBuffer(ctx: BaseAudioContext, type: Exclude<NoiseType, 'none'>, seconds = 24): AudioBuffer {
  const len = Math.floor(seconds * ctx.sampleRate);
  const fade = Math.floor(0.5 * ctx.sampleRate);
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') {
      raw[i] = w * 0.5;
    } else if (type === 'pink') {
      // Filtro de Paul Kellet.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.5;
    }
  }
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  d.set(raw.subarray(0, len));
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    d[i] = d[i] * x + raw[len + i] * (1 - x);
  }
  return normalizeBuffer(buf, 0.12);
}
