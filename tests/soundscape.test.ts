import { describe, expect, it } from 'vitest';
import { Rng, Soundscape, type SceneId } from '../src/lib/audio/soundscape/dsp';

const SR = 48000;
const SCENES: SceneId[] = ['white', 'pink', 'brown', 'ocean', 'rain', 'wind', 'fire', 'night', 'ambient'];

/** Genera `seconds` segundos en bloques de 128, como el AudioWorklet. */
function render(s: Soundscape, seconds: number) {
  const n = Math.floor((seconds * SR) / 128) * 128;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) s.render(L.subarray(i, i + 128), R.subarray(i, i + 128));
  return { L, R };
}

const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

function correlation(a: Float32Array, b: Float32Array) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb || 1);
}

describe('paisajes sonoros generativos', () => {
  it.each(SCENES)('%s: suena a volumen de dormir, sin saturar y en estéreo', (id) => {
    const s = new Soundscape(SR, 7, 0.01);
    s.setScene(id);
    const { L, R } = render(s, 30);
    const skip = 2 * SR; // tras la entrada
    const l = L.subarray(skip);
    const r = R.subarray(skip);
    expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
    const level = (rms(l) + rms(r)) / 2;
    expect(level).toBeGreaterThan(0.035);
    expect(level).toBeLessThan(0.18);
    expect(Math.max(peak(l), peak(r))).toBeLessThan(0.95);
    // Izquierda y derecha no son idénticas: hay espacio.
    expect(correlation(l, r)).toBeLessThan(0.995);
  }, 20000);

  it('nunca se repite: dos tramos separados por la duración del antiguo bucle no coinciden', () => {
    const s = new Soundscape(SR, 3, 0.01);
    s.setScene('rain');
    const { L } = render(s, 30);
    const a = L.subarray(2 * SR, 3 * SR);
    const b = L.subarray(26 * SR, 27 * SR);
    expect(Math.abs(correlation(a, b))).toBeLessThan(0.05);
  }, 20000);

  it('la misma semilla produce el mismo sonido (reproducible en tests)', () => {
    const a = new Soundscape(SR, 99, 0.01);
    const b = new Soundscape(SR, 99, 0.01);
    a.setScene('fire');
    b.setScene('fire');
    expect(render(a, 1).L).toEqual(render(b, 1).L);
  });

  it('el cambio de escena es un fundido continuo, sin saltos', () => {
    const s = new Soundscape(SR, 5, 3);
    s.setScene('brown');
    render(s, 4);
    s.setScene('ocean');
    const { L } = render(s, 4);
    let maxJump = 0;
    for (let i = 1; i < L.length; i++) maxJump = Math.max(maxJump, Math.abs(L[i] - L[i - 1]));
    expect(maxJump).toBeLessThan(0.3);
    expect(s.scene).toBe('ocean');
  }, 20000);

  it('«none» es silencio tras el fundido', () => {
    const s = new Soundscape(SR, 1, 0.5);
    s.setScene('pink');
    render(s, 1);
    s.setScene('none');
    const { L } = render(s, 2);
    expect(rms(L.subarray(SR))).toBe(0);
  });

  it('Rng: valores en [0,1) bien repartidos', () => {
    const r = new Rng(42);
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(sum / 100000).toBeCloseTo(0.5, 2);
  });
});
