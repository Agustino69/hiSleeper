import { db } from '../db';
import type { CueSoundId, NoiseType, Track } from '../types';
import { isNative, nativeVoiceList, speakNative, stopNativeSpeech, type VoiceInfo } from '../native';
import { createNoiseBuffer, normalizeBuffer, renderCue } from './synth';

/**
 * Motor de audio: un AudioContext con dos buses.
 *   ruido de fondo ─────────────────────────────┐
 *   pistas → paso bajo (suaviza sibilantes) → compresor ─→ master → salida
 * El compresor evita picos que puedan despertarte.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private cueBus!: GainNode;
  private noiseGain!: GainNode;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private noiseType: NoiseType = 'none';
  private cueCache = new Map<CueSoundId, Promise<AudioBuffer>>();
  private trackCache = new Map<string, Promise<AudioBuffer>>();
  private playing = new Set<{ stop: () => void }>();
  private keepAlive: HTMLAudioElement | null = null;

  /** Debe llamarse desde un gesto del usuario (toque) la primera vez. */
  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);

      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      this.noiseGain.connect(this.master);

      this.cueBus = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.ratio.value = 6;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      this.cueBus.connect(lp).connect(comp).connect(this.master);
      this.ctx = ctx;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /**
   * En iOS el audio web se silencia con el interruptor de silencio y se corta
   * antes; un <audio> silencioso en bucle mantiene la sesión como "reproducción".
   */
  startKeepAlive() {
    if (this.keepAlive) return;
    const el = new Audio(silentWavUrl());
    el.loop = true;
    el.volume = 0.01;
    el.setAttribute('playsinline', '');
    el.play().catch(() => undefined);
    this.keepAlive = el;
  }

  stopKeepAlive() {
    this.keepAlive?.pause();
    this.keepAlive = null;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  async setNoise(type: NoiseType, gain: number, fadeSec = 3) {
    const ctx = await this.ensure();
    const now = ctx.currentTime;
    if (type !== this.noiseType) {
      this.stopNoiseSource(fadeSec);
      this.noiseType = type;
      if (type !== 'none') {
        const src = ctx.createBufferSource();
        src.buffer = createNoiseBuffer(ctx, type === 'ocean' ? 'brown' : type);
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 1;
        src.connect(g).connect(this.noiseGain);
        if (type === 'ocean') {
          // Oleaje: modulación lenta de la amplitud (~1 ola cada 9 s).
          const lfo = ctx.createOscillator();
          const depth = ctx.createGain();
          lfo.frequency.value = 0.11;
          depth.gain.value = 0.55;
          g.gain.value = 0.6;
          lfo.connect(depth).connect(g.gain);
          lfo.start();
          this.lfo = lfo;
        }
        src.start();
        this.noiseSrc = src;
      }
    }
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(this.noiseGain.gain.value, now);
    this.noiseGain.gain.linearRampToValueAtTime(type === 'none' ? 0 : gain, now + fadeSec);
  }

  private stopNoiseSource(fadeSec: number) {
    const src = this.noiseSrc;
    const lfo = this.lfo;
    this.noiseSrc = null;
    this.lfo = null;
    if (!this.ctx) return;
    const stopAt = this.ctx.currentTime + fadeSec + 0.1;
    src?.stop(stopAt);
    lfo?.stop(stopAt);
  }

  async fadeOutNoise(sec: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.noiseGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.setValueAtTime(this.noiseGain.gain.value, now);
    this.noiseGain.gain.linearRampToValueAtTime(0, now + sec);
    this.stopNoiseSource(sec);
    this.noiseType = 'none';
  }

  private cueBuffer(id: CueSoundId) {
    let p = this.cueCache.get(id);
    if (!p) {
      p = renderCue(id);
      this.cueCache.set(id, p);
    }
    return p;
  }

  private trackBuffer(track: Track) {
    let p = this.trackCache.get(track.id);
    if (!p) {
      p = (async () => {
        const ctx = await this.ensure();
        const blob = track.blobKey ? await db.blobs.get(track.blobKey) : undefined;
        if (!blob) throw new Error(`Audio no encontrado: ${track.name}`);
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        return normalizeBuffer(trimSilence(buf));
      })();
      p.catch(() => this.trackCache.delete(track.id));
      this.trackCache.set(track.id, p);
    }
    return p;
  }

  /** Precarga para que la primera reproducción nocturna no tenga retraso. */
  async preload(cues: CueSoundId[], tracks: Track[]) {
    await Promise.allSettled([
      ...cues.map((c) => this.cueBuffer(c)),
      ...tracks.filter((t) => t.kind !== 'tts').map((t) => this.trackBuffer(t)),
    ]);
  }

  async playCue(id: CueSoundId, gain: number): Promise<void> {
    await this.playBuffer(await this.cueBuffer(id), gain);
  }

  async playTrack(track: Track, gain: number): Promise<void> {
    if (track.kind === 'tts') return speak(track, gain, this.playing);
    await this.playBuffer(await this.trackBuffer(track), gain);
  }

  async playBuffer(buf: AudioBuffer, gain: number): Promise<void> {
    const ctx = await this.ensure();
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    const t0 = ctx.currentTime + 0.05;
    // Rampa de entrada y salida de 80 ms: sin clics.
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.08);
    g.gain.setValueAtTime(gain, Math.max(t0 + 0.08, t0 + buf.duration - 0.08));
    g.gain.linearRampToValueAtTime(0, t0 + buf.duration);
    src.connect(g).connect(this.cueBus);
    await new Promise<void>((resolve) => {
      const handle = {
        stop: () => {
          const now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + 0.4);
          src.stop(now + 0.45);
        },
      };
      this.playing.add(handle);
      src.onended = () => {
        this.playing.delete(handle);
        resolve();
      };
      src.start(t0);
    });
  }

  /** Detiene (con fundido) todo lo que suene en el bus de pistas. */
  stopCues() {
    for (const p of [...this.playing]) p.stop();
    this.playing.clear();
  }

  async stopAll() {
    this.stopCues();
    await this.fadeOutNoise(1.5);
  }

  forgetTrack(id: string) {
    this.trackCache.delete(id);
  }
}

/** Recorta silencios al principio y al final de una grabación. */
function trimSilence(buf: AudioBuffer, threshold = 0.01): AudioBuffer {
  const d = buf.getChannelData(0);
  let a = 0;
  let b = d.length - 1;
  while (a < b && Math.abs(d[a]) < threshold) a++;
  while (b > a && Math.abs(d[b]) < threshold) b--;
  const pad = Math.floor(0.1 * buf.sampleRate);
  a = Math.max(0, a - pad);
  b = Math.min(d.length - 1, b + pad);
  if (b - a < buf.sampleRate * 0.2 || (a === 0 && b === d.length - 1)) return buf;
  const out = new AudioBuffer({ length: b - a + 1, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b + 1), c);
  return out;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
function webVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const v = speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
  return cachedVoices;
}

/** Voces disponibles: las del sistema Android en la app nativa, las del navegador en la web. */
export async function listVoices(): Promise<VoiceInfo[]> {
  if (isNative) return nativeVoiceList();
  if (typeof speechSynthesis === 'undefined') return [];
  if (!webVoices().length) {
    // Algunos navegadores cargan la lista de voces de forma asíncrona.
    await new Promise<void>((resolve) => {
      speechSynthesis.addEventListener('voiceschanged', () => resolve(), { once: true });
      setTimeout(resolve, 1500);
    });
  }
  return webVoices();
}

export function hasSpeech(): boolean {
  return isNative || typeof speechSynthesis !== 'undefined';
}

export function defaultVoice(voices: VoiceInfo[]): VoiceInfo | undefined {
  const lang = navigator.language.slice(0, 2);
  return voices.find((v) => v.lang.startsWith(lang) && v.localService) ?? voices.find((v) => v.lang.startsWith(lang));
}

/**
 * Voz sintetizada. No pasa por el AudioContext (el sistema no lo permite),
 * así que el volumen se aplica directamente al enunciado.
 */
function speak(track: Track, gain: number, playing: Set<{ stop: () => void }>): Promise<void> {
  if (!track.text || !hasSpeech()) return Promise.resolve();
  const volume = Math.min(1, gain * 1.5);
  const rate = track.ttsRate ?? 0.85;
  if (isNative) {
    const handle = { stop: stopNativeSpeech };
    playing.add(handle);
    return speakNative(track.text, { voiceURI: track.ttsVoice, rate, volume })
      .catch(() => undefined)
      .finally(() => playing.delete(handle));
  }
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(track.text);
    const voices = webVoices();
    const voice = voices.find((v) => v.voiceURI === track.ttsVoice) ?? defaultVoice(voices);
    if (voice) {
      u.voice = voice as SpeechSynthesisVoice;
      u.lang = voice.lang;
    }
    u.rate = rate;
    u.pitch = 0.95;
    u.volume = volume;
    const handle = { stop: () => speechSynthesis.cancel() };
    playing.add(handle);
    const done = () => {
      playing.delete(handle);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    // Algunos navegadores no disparan onend si la página se ralentiza.
    setTimeout(done, 15000 + (track.text?.length ?? 0) * 150);
    speechSynthesis.speak(u);
  });
}

let silentUrl: string | null = null;
function silentWavUrl(): string {
  if (silentUrl) return silentUrl;
  const sr = 8000;
  const n = sr; // 1 s
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

export const engine = new AudioEngine();
