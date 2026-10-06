import { describe, expect, it } from 'vitest';
import {
  estimateHypnogram,
  minutesUntil,
  planWindows,
  volumeToGain,
  windowEnvelope,
} from '../src/lib/schedule';

const night = { latencyMin: 20, cycleMin: 90, totalMin: 480 };

describe('estimateHypnogram', () => {
  it('cubre la noche entera sin huecos', () => {
    const h = estimateHypnogram(night);
    expect(h[0]).toMatchObject({ stage: 'wake', start: 0, end: 20 });
    for (let i = 1; i < h.length; i++) expect(h[i].start).toBeCloseTo(h[i - 1].end);
    expect(h[h.length - 1].end).toBe(480);
  });

  it('concentra el sueño profundo al principio y el REM al final', () => {
    const h = estimateHypnogram(night);
    const n3 = h.filter((s) => s.stage === 'N3');
    const rem = h.filter((s) => s.stage === 'REM');
    expect(n3[0].end - n3[0].start).toBeGreaterThan(n3[n3.length - 1].end - n3[n3.length - 1].start);
    expect(rem[rem.length - 2].end - rem[rem.length - 2].start).toBeGreaterThan(rem[0].end - rem[0].start);
  });

  it('escala con la duración del ciclo', () => {
    const h = estimateHypnogram({ latencyMin: 0, cycleMin: 100, totalMin: 100 });
    expect(h[h.length - 1]).toMatchObject({ stage: 'REM', cycle: 0 });
    expect(h.filter((s) => s.cycle === 0).reduce((a, s) => a + s.end - s.start, 0)).toBeCloseTo(100);
  });
});

describe('planWindows', () => {
  it('repaso solo en sueño profundo de los primeros ciclos', () => {
    const w = planWindows({ ...night, goals: ['review'], deepCycles: 2 });
    expect(w.map((x) => x.kind)).toEqual(['deep', 'deep']);
    const h = estimateHypnogram(night);
    for (const win of w) {
      const seg = h.find((s) => s.stage === 'N3' && win.start >= s.start && win.end <= s.end);
      expect(seg).toBeDefined();
    }
  });

  it('incubación de sueños: inicio + REM tardíos', () => {
    const w = planWindows({ ...night, goals: ['dream'] });
    expect(w[0].kind).toBe('onset');
    expect(w.filter((x) => x.kind === 'rem').length).toBeGreaterThanOrEqual(2);
    expect(w.some((x) => x.kind === 'deep')).toBe(false);
  });

  it('mantra al amanecer solo con hora de despertar, sin solaparse', () => {
    expect(planWindows({ ...night, goals: ['mantra'] }).some((x) => x.kind === 'dawn')).toBe(false);
    const w = planWindows({ ...night, goals: ['mantra', 'dream'], hasWakeTime: true });
    const dawn = w.find((x) => x.kind === 'dawn')!;
    expect(dawn.end).toBeLessThanOrEqual(480);
    for (const x of w) if (x !== dawn) expect(x.end <= dawn.start || x.start >= dawn.end).toBe(true);
    expect(w.find((x) => x.kind === 'onset')!.goals.sort()).toEqual(['dream', 'mantra']);
  });

  it('una siesta corta no genera ventanas imposibles', () => {
    const w = planWindows({ latencyMin: 10, cycleMin: 90, totalMin: 25, goals: ['review', 'dream'] });
    for (const x of w) {
      expect(x.end).toBeGreaterThan(x.start);
      expect(x.end).toBeLessThanOrEqual(25);
    }
  });
});

describe('envolvente y volumen', () => {
  it('la ventana de inicio baja mientras te duermes', () => {
    const [onset] = planWindows({ ...night, goals: ['mantra'] });
    expect(windowEnvelope(onset, onset.start)).toBeCloseTo(1);
    expect(windowEnvelope(onset, onset.end - 0.01)).toBeLessThan(0.3);
  });

  it('las ventanas de sueño suben y bajan suavemente', () => {
    const [deep] = planWindows({ ...night, goals: ['review'] });
    const mid = (deep.start + deep.end) / 2;
    expect(windowEnvelope(deep, deep.start)).toBeLessThan(windowEnvelope(deep, mid));
    expect(windowEnvelope(deep, mid)).toBe(1);
    expect(windowEnvelope(deep, deep.end + 1)).toBe(0);
  });

  it('volumen logarítmico', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBeCloseTo(Math.pow(10, -30 / 20));
  });

  it('minutesUntil pasa al día siguiente', () => {
    const from = new Date(2026, 0, 1, 23, 0);
    expect(minutesUntil('07:00', from)).toBe(480);
    expect(minutesUntil('23:30', from)).toBe(30);
    expect(minutesUntil('xx', from)).toBeNull();
  });
});
