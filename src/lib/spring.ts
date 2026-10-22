/**
 * Resortes al estilo de Apple: se describen con dos parámetros de diseño en
 * lugar de masa/rigidez/fricción.
 *  - damping: razón de amortiguación. 1 = sin rebote; < 1 = rebota.
 *  - response: segundos que tarda, aproximadamente, en llegar al objetivo.
 * Un resorte no tiene duración fija: es interrumpible y parte siempre del valor
 * y la velocidad actuales, así que se puede redirigir a mitad de camino.
 */

export interface SpringParams {
  damping: number;
  response: number;
}

/** Valores que usa Apple: sin rebote por defecto; algo de rebote solo tras un gesto con inercia. */
export const SPRING = {
  default: { damping: 1, response: 0.35 },
  sheet: { damping: 0.8, response: 0.3 },
  dismiss: { damping: 1, response: 0.3 },
} satisfies Record<string, SpringParams>;

/** Avanza el resorte `dt` segundos (Euler semiimplícito con subpasos estables). */
export function springStep(x: number, v: number, target: number, p: SpringParams, dt: number): [number, number] {
  const k = Math.pow((2 * Math.PI) / p.response, 2);
  const c = (4 * Math.PI * p.damping) / p.response;
  const steps = Math.max(1, Math.ceil(dt / (1 / 480)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -k * (x - target) - c * v;
    v += a * h;
    x += v * h;
  }
  return [x, v];
}

/**
 * Proyección de la inercia (función que usa Apple): a dónde llegaría el
 * elemento si siguiera desacelerando como un scroll. `velocity` en px/s.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistencia progresiva al pasar un límite: cuanto más lejos, menos sigue al dedo. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Velocidad (px/s) a partir de las últimas muestras de un gesto. */
export function releaseVelocity(samples: Array<{ y: number; t: number }>): number {
  const now = samples[samples.length - 1];
  if (!now) return 0;
  // Solo cuentan los últimos ~100 ms: lo que el dedo hacía al soltar.
  const old = samples.find((s) => now.t - s.t <= 100) ?? now;
  const dt = (now.t - old.t) / 1000;
  return dt > 0 ? (now.y - old.y) / dt : 0;
}

/** Animador de un valor con resorte, interrumpible y con traspaso de velocidad. */
export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private params: SpringParams = SPRING.default;
  private raf = 0;
  private last = 0;
  private onRest: (() => void) | null = null;

  constructor(
    initial: number,
    private onUpdate: (value: number) => void,
    private precision = 0.5,
  ) {
    this.value = initial;
    this.target = initial;
  }

  get animating() {
    return this.raf !== 0;
  }

  /** Lleva el resorte a `target` desde el valor actual; opcionalmente con la velocidad del gesto. */
  to(target: number, params: SpringParams, velocity?: number, onRest?: () => void) {
    this.target = target;
    this.params = params;
    if (velocity !== undefined) this.velocity = velocity;
    this.onRest = onRest ?? null;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** Coloca el valor sin animar (seguimiento 1:1 del dedo). Detiene la animación en curso. */
  set(value: number, velocity = 0) {
    this.stop();
    this.value = value;
    this.velocity = velocity;
    this.onUpdate(value);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onRest = null;
  }

  private frame = (now: number) => {
    // Se limita el paso para que una pestaña en segundo plano no «salte».
    const dt = Math.min(0.064, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    [this.value, this.velocity] = springStep(this.value, this.velocity, this.target, this.params, dt);
    const done = Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 20;
    if (done) {
      this.value = this.target;
      this.velocity = 0;
    }
    this.onUpdate(this.value);
    if (done) {
      const cb = this.onRest;
      this.raf = 0;
      this.onRest = null;
      cb?.();
    } else {
      this.raf = requestAnimationFrame(this.frame);
    }
  };
}
