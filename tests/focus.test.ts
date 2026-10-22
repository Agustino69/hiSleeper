import { describe, expect, it } from 'vitest';
import { countdown, DEFAULT_FOCUS, IDLE_STATE, StepDetector, SUGGESTED_PACKAGES, wakeDetectionFrom } from '../src/lib/focus';

describe('modo dormir', () => {
  it('valores por defecto: cuenta atrás de 30 min, sueño mínimo de 5 h y alarma anti-sueño', () => {
    expect(DEFAULT_FOCUS).toMatchObject({ windDownMin: 30, minSleepMin: 300, antiSnooze: true, enabled: false });
  });

  it('la cuenta atrás se muestra en minutos y segundos, sin negativos', () => {
    expect(countdown(30 * 60000)).toBe('30:00');
    expect(countdown(61_500)).toBe('1:02');
    expect(countdown(-5000)).toBe('0:00');
  });

  it('el despertar se detecta a partir del sueño mínimo', () => {
    const sleepAt = new Date(2026, 9, 22, 23, 30).getTime();
    expect(wakeDetectionFrom({ ...IDLE_STATE, phase: 'sleep', sleepAt }, DEFAULT_FOCUS)).toBe(new Date(2026, 9, 23, 4, 30).getTime());
  });

  it('las apps sugeridas nunca incluyen teléfono, mensajes ni ajustes', () => {
    expect(SUGGESTED_PACKAGES.some((p) => /dialer|messaging|settings|deskclock/.test(p))).toBe(false);
  });
});

describe('StepDetector', () => {
  const walk = (seconds: number, hz: number, amp: number, noise = 0) => {
    const d = new StepDetector();
    for (let i = 0; i < seconds * 60; i++) {
      const tt = (i / 60) * 1000;
      const z = 9.81 + amp * Math.max(0, Math.sin(2 * Math.PI * hz * (i / 60))) + noise * (Math.random() - 0.5);
      d.push(0.3, 0.2, z, tt);
    }
    return d.count;
  };

  it('cuenta pasos al caminar (~2 pasos por segundo)', () => {
    const n = walk(10, 2, 4);
    expect(n).toBeGreaterThanOrEqual(18);
    expect(n).toBeLessThanOrEqual(21);
  });

  it('no cuenta pasos con el móvil quieto o con temblor leve', () => {
    expect(walk(10, 2, 0, 0.6)).toBe(0);
  });

  it('ignora sacudidas más rápidas que un paso humano', () => {
    expect(walk(5, 8, 4)).toBeLessThanOrEqual(5 * 1000 / 280 + 1);
  });
});
