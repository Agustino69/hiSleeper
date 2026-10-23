/**
 * Paisajes sonoros generados en tiempo real (síntesis procedural): nada de
 * grabaciones ni búferes en bucle. Cada muestra se calcula al momento, así que
 * el sonido nunca se repite. Los modelos siguen la síntesis procedural clásica
 * (A. Farnell, «Designing Sound»): ruido filtrado como lecho y eventos físicos
 * (gotas, crestas de ola, chasquidos, chirridos) con tiempos aleatorios.
 *
 * TypeScript puro (sin APIs del navegador): lo usa el AudioWorklet y se prueba en Node.
 */

import type { NoiseType } from '../../types';

export type SceneId = NoiseType;

/** Generador pseudoaleatorio rápido y reproducible (xorshift32). */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  /** Ruido blanco en [-1, 1). */
  white(): number {
    return this.next() * 2 - 1;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** Ruido rosa (filtro de Paul Kellet). */
class Pink {
  private b = [0, 0, 0, 0, 0, 0, 0];
  process(w: number): number {
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }
}

/** Ruido marrón: integrador con fuga (sin deriva de continua). */
class Brown {
  private last = 0;
  process(w: number): number {
    this.last = (this.last + 0.02 * w) / 1.02;
    return this.last * 3.5;
  }
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** Biquad (fórmulas de R. Bristow-Johnson), con coeficientes que se pueden mover en cada bloque. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  constructor(
    private sr: number,
    private type: FilterType,
    freq: number,
    q = 0.707,
  ) {
    this.set(freq, q);
  }
  set(freq: number, q = 0.707) {
    const f = Math.min(Math.max(freq, 10), this.sr * 0.45);
    const w = (2 * Math.PI * f) / this.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    // Forma directa II transpuesta.
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/**
 * Deriva lenta: va hacia objetivos aleatorios con transiciones suaves de duración
 * aleatoria. Da «vida» sin patrones repetitivos (no es un LFO periódico).
 */
class Drift {
  value: number;
  private from: number;
  private to: number;
  private t = 0;
  private dur: number;
  constructor(
    private rng: Rng,
    private min: number,
    private max: number,
    private minDur: number,
    private maxDur: number,
  ) {
    this.value = this.from = this.to = rng.range(min, max);
    this.dur = rng.range(minDur, maxDur);
  }
  step(dt: number): number {
    this.t += dt;
    if (this.t >= this.dur) {
      this.t = 0;
      this.from = this.to;
      this.to = this.rng.range(this.min, this.max);
      this.dur = this.rng.range(this.minDur, this.maxDur);
    }
    const x = this.t / this.dur;
    const s = x * x * (3 - 2 * x);
    this.value = this.from + (this.to - this.from) * s;
    return this.value;
  }
}

/** Una escena genera estéreo a partir de muestras; `control` se llama una vez por bloque. */
interface Scene {
  control(dt: number): void;
  sample(out: [number, number]): void;
}

const BLOCK = 128;

// ── Ruidos «vivos» ──

class NoiseScene implements Scene {
  private gens: Array<{ process(w: number): number }>;
  private lp: Biquad[];
  private level: Drift;
  private tone: Drift;
  constructor(
    private rng: Rng,
    sr: number,
    color: 'white' | 'pink' | 'brown',
  ) {
    const make = () => (color === 'pink' ? new Pink() : color === 'brown' ? new Brown() : { process: (w: number) => w * 0.5 });
    this.gens = [make(), make(), make()];
    const base = color === 'white' ? 14000 : color === 'pink' ? 9000 : 3000;
    this.tone = new Drift(rng, base * 0.6, base, 20, 70);
    this.level = new Drift(rng, 0.85, 1, 15, 60);
    this.lp = [new Biquad(sr, 'lowpass', base), new Biquad(sr, 'lowpass', base)];
  }
  control(dt: number) {
    const f = this.tone.step(dt);
    this.lp[0].set(f);
    this.lp[1].set(f * 1.03);
    this.level.step(dt);
  }
  sample(out: [number, number]) {
    // Una parte común (centro) y otra independiente por canal: estéreo natural.
    const c = this.gens[0].process(this.rng.white());
    const l = this.gens[1].process(this.rng.white());
    const r = this.gens[2].process(this.rng.white());
    const g = this.level.value;
    out[0] = this.lp[0].process(0.65 * c + 0.55 * l) * g;
    out[1] = this.lp[1].process(0.65 * c + 0.55 * r) * g;
  }
}

// ── Oleaje ──

/** Una ola: subida lenta, cresta con espuma y retirada larga; cada una distinta. */
class Wave {
  private t = 0;
  private dur = 0;
  private amp = 0;
  private gap = 0;
  env = 0;
  constructor(
    private rng: Rng,
    start: number,
  ) {
    this.next();
    this.t = -start;
  }
  private next() {
    this.t = 0;
    this.dur = this.rng.range(6, 12);
    this.amp = this.rng.range(0.45, 1);
    this.gap = this.rng.range(0, 3);
  }
  step(dt: number) {
    this.t += dt;
    if (this.t >= this.dur + this.gap) this.next();
    if (this.t < 0 || this.t > this.dur) {
      this.env = 0;
      return;
    }
    const x = this.t / this.dur;
    const rise = 0.35;
    const e = x < rise ? Math.sin(((x / rise) * Math.PI) / 2) ** 2 : Math.exp(-((x - rise) / (1 - rise)) * 4) * (1 - (x - rise) / (1 - rise)) ** 0.5;
    this.env = e * this.amp;
  }
}

class OceanScene implements Scene {
  private brown = [new Brown(), new Brown()];
  private pink = [new Pink(), new Pink()];
  private lp: Biquad[];
  private foamHp: Biquad[];
  private waves: Wave[];
  constructor(
    private rng: Rng,
    sr: number,
  ) {
    this.lp = [new Biquad(sr, 'lowpass', 500, 0.6), new Biquad(sr, 'lowpass', 500, 0.6)];
    this.foamHp = [new Biquad(sr, 'highpass', 2500), new Biquad(sr, 'highpass', 2500)];
    this.waves = [new Wave(rng, 0), new Wave(rng, 4.5)];
  }
  control(dt: number) {
    for (const w of this.waves) w.step(dt);
    const [a, b] = this.waves;
    this.lp[0].set(250 + 2600 * (0.75 * a.env + 0.35 * b.env), 0.6);
    this.lp[1].set(250 + 2600 * (0.35 * a.env + 0.75 * b.env), 0.6);
  }
  sample(out: [number, number]) {
    const [a, b] = this.waves;
    for (let ch = 0; ch < 2; ch++) {
      const e = ch === 0 ? 0.75 * a.env + 0.35 * b.env : 0.35 * a.env + 0.75 * b.env;
      const body = this.lp[ch].process(0.7 * this.brown[ch].process(this.rng.white()) + 0.5 * this.pink[ch].process(this.rng.white()));
      const foam = this.foamHp[ch].process(this.rng.white()) * e * e * e * 0.35;
      out[ch] = body * (0.18 + 1.1 * e) + foam;
    }
  }
}

// ── Lluvia ──

interface Drop {
  phase: number;
  freq: number;
  chirp: number;
  amp: number;
  decay: number;
  panL: number;
  panR: number;
  noisy: boolean;
}

class RainScene implements Scene {
  private pink = [new Pink(), new Pink()];
  private brown = new Brown();
  private bed: Biquad[];
  private hiss: Biquad[];
  private rumble: Biquad;
  private dropHp: Biquad[];
  private intensity: Drift;
  private center: Drift;
  private drops: Drop[] = [];
  private rate = 30;
  constructor(
    private rng: Rng,
    private sr: number,
  ) {
    this.bed = [new Biquad(sr, 'bandpass', 1400, 0.6), new Biquad(sr, 'bandpass', 1500, 0.6)];
    this.hiss = [new Biquad(sr, 'highpass', 5000), new Biquad(sr, 'highpass', 5200)];
    this.rumble = new Biquad(sr, 'lowpass', 180);
    this.dropHp = [new Biquad(sr, 'highpass', 900), new Biquad(sr, 'highpass', 900)];
    // De llovizna a lluvia moderada en el transcurso de minutos.
    this.intensity = new Drift(rng, 0.35, 0.9, 30, 120);
    this.center = new Drift(rng, 900, 2300, 15, 60);
  }
  control(dt: number) {
    const i = this.intensity.step(dt);
    const c = this.center.step(dt);
    this.bed[0].set(c, 0.6);
    this.bed[1].set(c * 1.07, 0.6);
    this.rate = 12 + 90 * i;
  }
  private spawn() {
    if (this.drops.length > 96) return;
    const pan = this.rng.next();
    const near = this.rng.next() ** 3;
    this.drops.push({
      phase: 0,
      freq: this.rng.range(1600, 4800),
      chirp: this.rng.range(0.9993, 0.99985),
      amp: 0.012 + 0.12 * near,
      decay: Math.exp(-1 / (this.sr * this.rng.range(0.004, 0.018))),
      panL: Math.cos((pan * Math.PI) / 2),
      panR: Math.sin((pan * Math.PI) / 2),
      noisy: this.rng.next() < 0.5,
    });
  }
  sample(out: [number, number]) {
    // Proceso de Poisson: cada muestra tiene probabilidad rate/sr de traer una gota.
    if (this.rng.next() < this.rate / this.sr) this.spawn();
    const i = this.intensity.value;
    const rumble = this.rumble.process(this.brown.process(this.rng.white())) * 0.25;
    let dl = 0;
    let dr = 0;
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      d.phase += (2 * Math.PI * d.freq) / this.sr;
      d.freq *= d.chirp;
      const v = d.noisy ? this.rng.white() * d.amp : Math.sin(d.phase) * d.amp;
      dl += v * d.panL;
      dr += v * d.panR;
      d.amp *= d.decay;
      if (d.amp < 1e-4) this.drops.splice(k, 1);
    }
    for (let ch = 0; ch < 2; ch++) {
      const p = this.pink[ch].process(this.rng.white());
      const bed = this.bed[ch].process(p) * (0.6 + 0.9 * i);
      const hiss = this.hiss[ch].process(this.rng.white()) * 0.05 * i;
      out[ch] = bed + hiss + rumble + this.dropHp[ch].process(ch === 0 ? dl : dr);
    }
  }
}

// ── Viento ──

class WindScene implements Scene {
  private pink = [new Pink(), new Pink()];
  private brown = new Brown();
  private bp: Biquad[];
  private low: Biquad;
  private centers: Drift[];
  private gust: Drift;
  private q: Drift;
  constructor(
    private rng: Rng,
    sr: number,
  ) {
    this.bp = [new Biquad(sr, 'bandpass', 400, 2), new Biquad(sr, 'bandpass', 500, 2)];
    this.low = new Biquad(sr, 'lowpass', 120);
    this.centers = [new Drift(rng, 220, 900, 2.5, 9), new Drift(rng, 240, 950, 3, 10)];
    this.gust = new Drift(rng, 0.25, 1, 2, 8);
    this.q = new Drift(rng, 1.2, 3.2, 4, 12);
  }
  control(dt: number) {
    const q = this.q.step(dt);
    this.gust.step(dt);
    this.bp[0].set(this.centers[0].step(dt), q);
    this.bp[1].set(this.centers[1].step(dt), q);
  }
  sample(out: [number, number]) {
    const low = this.low.process(this.brown.process(this.rng.white())) * 0.35;
    const g = this.gust.value;
    for (let ch = 0; ch < 2; ch++) out[ch] = this.bp[ch].process(this.pink[ch].process(this.rng.white())) * (0.6 + 2.4 * g) + low;
  }
}

// ── Fogata ──

interface Crackle {
  left: number;
  amp: number;
  decay: number;
  panL: number;
  panR: number;
  burst: number;
  gap: number;
}

class FireScene implements Scene {
  private brown = [new Brown(), new Brown()];
  private roar: Biquad[];
  private hissHp: Biquad[];
  private clickHp: Biquad[];
  private rate: Drift;
  private warmth: Drift;
  private crackles: Crackle[] = [];
  constructor(
    private rng: Rng,
    private sr: number,
  ) {
    this.roar = [new Biquad(sr, 'lowpass', 220), new Biquad(sr, 'lowpass', 240)];
    this.hissHp = [new Biquad(sr, 'highpass', 3500), new Biquad(sr, 'highpass', 3600)];
    this.clickHp = [new Biquad(sr, 'highpass', 1400), new Biquad(sr, 'highpass', 1400)];
    this.rate = new Drift(rng, 1.5, 9, 4, 20);
    this.warmth = new Drift(rng, 0.6, 1, 8, 30);
  }
  control(dt: number) {
    this.rate.step(dt);
    this.warmth.step(dt);
  }
  sample(out: [number, number]) {
    // Ráfagas de chasquidos (la madera estalla en series cortas).
    if (this.rng.next() < this.rate.value / this.sr && this.crackles.length < 24) {
      const pan = this.rng.next();
      this.crackles.push({
        left: Math.floor(this.rng.range(1, 6)),
        amp: 0.05 + 0.5 * this.rng.next() ** 3,
        decay: Math.exp(-1 / (this.sr * this.rng.range(0.0008, 0.004))),
        panL: Math.cos((pan * Math.PI) / 2),
        panR: Math.sin((pan * Math.PI) / 2),
        burst: 0,
        gap: 0,
      });
    }
    let cl = 0;
    let cr = 0;
    for (let k = this.crackles.length - 1; k >= 0; k--) {
      const c = this.crackles[k];
      if (c.gap > 0) {
        c.gap--;
        continue;
      }
      const v = this.rng.white() * c.amp * Math.exp(-c.burst / (this.sr * 0.0025));
      cl += v * c.panL;
      cr += v * c.panR;
      c.burst++;
      if (c.burst > this.sr * 0.012) {
        c.left--;
        c.burst = 0;
        c.amp *= this.rng.range(0.4, 0.9);
        c.gap = Math.floor(this.sr * this.rng.range(0.005, 0.05));
        if (c.left <= 0) this.crackles.splice(k, 1);
      }
    }
    const w = this.warmth.value;
    for (let ch = 0; ch < 2; ch++) {
      const roar = this.roar[ch].process(this.brown[ch].process(this.rng.white())) * 1.6 * w;
      const hiss = this.hissHp[ch].process(this.rng.white()) * 0.02;
      out[ch] = roar + hiss + this.clickHp[ch].process(ch === 0 ? cl : cr);
    }
  }
}

// ── Noche con grillos ──

class Cricket {
  private phase = 0;
  private t = 0;
  private nextChirp: number;
  private pulsesLeft = 0;
  private pulseT = 0;
  private resting = 0;
  private freq: number;
  private pulseRate: number;
  private amp: number;
  readonly panL: number;
  readonly panR: number;
  constructor(
    private rng: Rng,
    private sr: number,
  ) {
    this.freq = rng.range(3900, 5200);
    this.pulseRate = rng.range(24, 38);
    this.amp = rng.range(0.02, 0.055);
    const pan = rng.next();
    this.panL = Math.cos((pan * Math.PI) / 2);
    this.panR = Math.sin((pan * Math.PI) / 2);
    this.nextChirp = rng.range(0, 1.5);
  }
  sample(): number {
    const dt = 1 / this.sr;
    this.t += dt;
    if (this.resting > 0) {
      this.resting -= dt;
      return 0;
    }
    if (this.pulsesLeft === 0 && this.t >= this.nextChirp) {
      this.pulsesLeft = Math.floor(this.rng.range(3, 7));
      this.pulseT = 0;
      this.t = 0;
      this.nextChirp = this.rng.range(0.35, 1.1);
      // De vez en cuando calla un rato, como los grillos de verdad.
      if (this.rng.next() < 0.04) this.resting = this.rng.range(3, 15);
    }
    if (this.pulsesLeft === 0) return 0;
    this.pulseT += dt;
    const period = 1 / this.pulseRate;
    const x = this.pulseT / period;
    if (x >= 1) {
      this.pulseT = 0;
      this.pulsesLeft--;
    }
    const env = x < 0.55 ? Math.sin((x / 0.55) * Math.PI) : 0;
    this.phase += (2 * Math.PI * this.freq) / this.sr;
    return Math.sin(this.phase) * env * this.amp;
  }
}

class NightScene implements Scene {
  private crickets: Cricket[];
  private pink = [new Pink(), new Pink()];
  private air: Biquad[];
  private breeze: Drift;
  constructor(
    private rng: Rng,
    sr: number,
  ) {
    this.crickets = Array.from({ length: 5 }, () => new Cricket(rng, sr));
    this.air = [new Biquad(sr, 'lowpass', 600), new Biquad(sr, 'lowpass', 560)];
    this.breeze = new Drift(rng, 0.06, 0.2, 4, 14);
  }
  control(dt: number) {
    this.breeze.step(dt);
  }
  sample(out: [number, number]) {
    let l = 0;
    let r = 0;
    for (const c of this.crickets) {
      const v = c.sample();
      l += v * c.panL;
      r += v * c.panR;
    }
    const b = this.breeze.value;
    out[0] = l + this.air[0].process(this.pink[0].process(this.rng.white())) * b;
    out[1] = r + this.air[1].process(this.pink[1].process(this.rng.white())) * b;
  }
}

// ── Música ambiental generativa ──

/**
 * Pentatónica de re mayor en registro medio: nada disuena entre sí, y no baja
 * de 110 Hz porque el altavoz de un teléfono no reproduce graves más profundos.
 */
const SCALE = [45, 47, 50, 52, 54, 57, 59, 62, 64, 66, 69, 71];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class PadVoice {
  private phase = [0, 0, 0, 0];
  private freq = 0;
  private detune = 1;
  private stage: 'rest' | 'attack' | 'hold' | 'release' = 'rest';
  private t = 0;
  private len = 0;
  private level = 0;
  private peak = 0;
  constructor(private rng: Rng) {
    this.len = rng.range(0, 8);
  }
  private pick() {
    this.freq = midiHz(SCALE[Math.floor(this.rng.next() * SCALE.length)]);
    this.peak = this.rng.range(0.03, 0.07);
    this.detune = this.rng.range(1.0004, 1.0012);
  }
  control(dt: number) {
    this.t += dt;
    if (this.t < this.len) return;
    this.t = 0;
    if (this.stage === 'rest') {
      this.pick();
      this.stage = 'attack';
      this.len = this.rng.range(4, 9);
    } else if (this.stage === 'attack') {
      this.stage = 'hold';
      this.len = this.rng.range(3, 12);
    } else if (this.stage === 'hold') {
      this.stage = 'release';
      this.len = this.rng.range(5, 11);
    } else {
      this.stage = 'rest';
      this.len = this.rng.range(0.5, 7);
    }
  }
  sample(sr: number): number {
    const x = this.len > 0 ? Math.min(1, this.t / this.len) : 1;
    const target = this.stage === 'attack' ? this.peak * x : this.stage === 'hold' ? this.peak : this.stage === 'release' ? this.peak * (1 - x) : 0;
    this.level += (target - this.level) * 0.0005;
    if (this.level < 1e-5) return 0;
    // Fundamental + octava y quinta suaves, con un segundo oscilador apenas
    // desafinado (1–2 cents, distinto en cada nota): un coro lento e irregular.
    const f = this.freq;
    this.phase[0] += (2 * Math.PI * f) / sr;
    this.phase[1] += (2 * Math.PI * f * this.detune) / sr;
    this.phase[2] += (2 * Math.PI * f * 2) / sr;
    this.phase[3] += (2 * Math.PI * f * 3) / sr;
    const p = this.phase;
    return this.level * (Math.sin(p[0]) + Math.sin(p[1]) + 0.3 * Math.sin(p[2]) + 0.1 * Math.sin(p[3])) * 0.5;
  }
}

class AmbientScene implements Scene {
  private voices: PadVoice[];
  private delayL: Float32Array;
  private delayR: Float32Array;
  private iL = 0;
  private iR = 0;
  private dampL = 0;
  private dampR = 0;
  private pink = new Pink();
  private air: Biquad;
  constructor(
    private rng: Rng,
    private sr: number,
  ) {
    this.voices = Array.from({ length: 5 }, () => new PadVoice(rng));
    this.delayL = new Float32Array(Math.floor(sr * 0.43));
    this.delayR = new Float32Array(Math.floor(sr * 0.61));
    this.air = new Biquad(sr, 'lowpass', 1200);
  }
  control(dt: number) {
    for (const v of this.voices) v.control(dt);
  }
  sample(out: [number, number]) {
    let dry = 0;
    for (const v of this.voices) dry += v.sample(this.sr);
    // Eco estéreo con realimentación cruzada y amortiguado: da espacio.
    const dl = this.delayL[this.iL];
    const dr = this.delayR[this.iR];
    this.dampL += (dl - this.dampL) * 0.35;
    this.dampR += (dr - this.dampR) * 0.35;
    this.delayL[this.iL] = dry + this.dampR * 0.55;
    this.delayR[this.iR] = dry + this.dampL * 0.55;
    this.iL = (this.iL + 1) % this.delayL.length;
    this.iR = (this.iR + 1) % this.delayR.length;
    const air = this.air.process(this.pink.process(this.rng.white())) * 0.05;
    out[0] = dry * 0.8 + this.dampL * 0.6 + air;
    out[1] = dry * 0.8 + this.dampR * 0.6 + air;
  }
}

class Silence implements Scene {
  control() {}
  sample(out: [number, number]) {
    out[0] = 0;
    out[1] = 0;
  }
}

/** Ganancia por escena para que todas suenen a un volumen parecido (RMS medido en tests/soundscape.test.ts). */
export const SCENE_GAIN: Record<SceneId, number> = {
  none: 0,
  white: 0.53, // el blanco es más áspero: algo más bajo
  pink: 0.82,
  brown: 0.8,
  ocean: 1.33,
  rain: 1.26,
  wind: 0.85,
  fire: 0.45,
  night: 3, // los grillos (4–5 kHz) se perciben fuertes con poca energía
  ambient: 2.6,
};

export function createScene(id: SceneId, rng: Rng, sr: number): Scene {
  switch (id) {
    case 'white':
    case 'pink':
    case 'brown':
      return new NoiseScene(rng, sr, id);
    case 'ocean':
      return new OceanScene(rng, sr);
    case 'rain':
      return new RainScene(rng, sr);
    case 'wind':
      return new WindScene(rng, sr);
    case 'fire':
      return new FireScene(rng, sr);
    case 'night':
      return new NightScene(rng, sr);
    case 'ambient':
      return new AmbientScene(rng, sr);
    default:
      return new Silence();
  }
}

/** Mezclador con transición suave (3 s, potencia constante) al cambiar de escena. */
export class Soundscape {
  private rng: Rng;
  private current: { id: SceneId; scene: Scene };
  private previous: { id: SceneId; scene: Scene } | null = null;
  private fade = 1;
  private fadeStep: number;
  private counter = 0;
  private tmp: [number, number] = [0, 0];

  constructor(
    private sr: number,
    seed = Date.now() >>> 0,
    fadeSeconds = 3,
  ) {
    this.rng = new Rng(seed);
    this.current = { id: 'none', scene: new Silence() };
    this.fadeStep = 1 / (fadeSeconds * sr);
  }

  get scene(): SceneId {
    return this.current.id;
  }

  setScene(id: SceneId) {
    if (id === this.current.id) return;
    this.previous = this.current;
    this.current = { id, scene: createScene(id, this.rng, this.sr) };
    this.fade = 0;
  }

  /** Rellena los dos canales (normalmente 128 muestras). */
  render(left: Float32Array, right: Float32Array) {
    const out = this.tmp;
    for (let i = 0; i < left.length; i++) {
      if (this.counter === 0) {
        const dt = BLOCK / this.sr;
        this.current.scene.control(dt);
        this.previous?.scene.control(dt);
      }
      this.counter = (this.counter + 1) % BLOCK;
      this.current.scene.sample(out);
      const gIn = SCENE_GAIN[this.current.id];
      let l = out[0] * gIn;
      let r = out[1] * gIn;
      if (this.previous) {
        this.fade = Math.min(1, this.fade + this.fadeStep);
        const a = Math.sin((this.fade * Math.PI) / 2);
        const b = Math.cos((this.fade * Math.PI) / 2);
        this.previous.scene.sample(out);
        const gOut = SCENE_GAIN[this.previous.id];
        l = l * a + out[0] * gOut * b;
        r = r * a + out[1] * gOut * b;
        if (this.fade >= 1) this.previous = null;
      }
      // Limitador suave: nunca satura aunque coincidan varios eventos.
      left[i] = Math.tanh(l);
      right[i] = Math.tanh(r);
    }
  }
}
