import { describe, expect, it } from 'vitest';
import { project, releaseVelocity, rubberband, springStep, type SpringParams } from '../src/lib/spring';

function simulate(p: SpringParams, from: number, to: number, v0 = 0, seconds = 2) {
  let x = from;
  let v = v0;
  const xs: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 120) {
    [x, v] = springStep(x, v, to, p, 1 / 120);
    xs.push(x);
  }
  return xs;
}

describe('springStep', () => {
  it('amortiguación crítica: llega sin pasarse', () => {
    const xs = simulate({ damping: 1, response: 0.35 }, 0, 100);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100.01);
    expect(xs[xs.length - 1]).toBeCloseTo(100, 1);
  });

  it('subamortiguado: rebota un poco y se asienta', () => {
    const xs = simulate({ damping: 0.8, response: 0.3 }, 0, 100);
    expect(Math.max(...xs)).toBeGreaterThan(100.5);
    expect(Math.max(...xs)).toBeLessThan(110);
    expect(xs[xs.length - 1]).toBeCloseTo(100, 1);
  });

  it('la respuesta marca la rapidez: casi en el objetivo tras ~response segundos', () => {
    const p = { damping: 1, response: 0.4 };
    const xs = simulate(p, 0, 100, 0, 1);
    expect(xs[Math.round(0.4 * 120)]).toBeGreaterThan(90);
    const fast = simulate({ damping: 1, response: 0.2 }, 0, 100, 0, 1);
    expect(fast[24]).toBeGreaterThan(xs[24]);
  });

  it('conserva la velocidad inicial del gesto (sin costura entre arrastre y animación)', () => {
    const [, v] = springStep(0, 2000, 0, { damping: 1, response: 0.35 }, 1 / 1000);
    expect(v).toBeGreaterThan(1900);
  });
});

describe('gestos', () => {
  it('proyección de inercia como la de Apple', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
    expect(project(1000, 0.99)).toBeCloseTo(99, 0);
  });

  it('rubber-band: resiste cada vez más y nunca supera el desplazamiento', () => {
    const a = rubberband(50, 600);
    const b = rubberband(200, 600);
    expect(a).toBeLessThan(50);
    expect(b).toBeLessThan(200);
    expect(b / 200).toBeLessThan(a / 50);
    expect(rubberband(-50, 600)).toBeCloseTo(-a);
  });

  it('velocidad de suelta a partir de los últimos 100 ms', () => {
    const samples = [
      { y: 0, t: 0 },
      { y: 10, t: 300 },
      { y: 20, t: 350 },
      { y: 70, t: 400 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo(((70 - 10) / 100) * 1000);
    expect(releaseVelocity([])).toBe(0);
  });
});
