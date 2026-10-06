import type { Goal } from './types';

/**
 * Modelo estimado del sueño (sin EEG). Se basa en la arquitectura típica de una
 * noche: el sueño profundo (N3) se concentra en los primeros ciclos y el REM se
 * alarga hacia la mañana. Todos los tiempos son minutos desde que pulsas "Dormir".
 */

export type Stage = 'wake' | 'N1' | 'N2' | 'N3' | 'REM';

export interface StageSegment {
  stage: Stage;
  start: number;
  end: number;
  /** Índice del ciclo (-1 para el periodo despierto inicial). */
  cycle: number;
}

export interface SleepParams {
  latencyMin: number;
  cycleMin: number;
  totalMin: number;
}

/** Duraciones de referencia (min) para un ciclo de 90 min, por número de ciclo. */
const CYCLE_TEMPLATES: Array<Array<[Stage, number]>> = [
  [['N1', 5], ['N2', 20], ['N3', 45], ['N2', 10], ['REM', 10]],
  [['N1', 2], ['N2', 25], ['N3', 30], ['N2', 15], ['REM', 18]],
  [['N1', 2], ['N2', 35], ['N3', 15], ['N2', 15], ['REM', 23]],
  [['N1', 2], ['N2', 45], ['N3', 5], ['N2', 10], ['REM', 28]],
  [['N1', 2], ['N2', 55], ['REM', 33]],
];

export function estimateHypnogram({ latencyMin, cycleMin, totalMin }: SleepParams): StageSegment[] {
  const segments: StageSegment[] = [];
  const latency = Math.max(0, Math.min(latencyMin, totalMin));
  if (latency > 0) segments.push({ stage: 'wake', start: 0, end: latency, cycle: -1 });

  const scale = cycleMin / 90;
  let t = latency;
  for (let cycle = 0; t < totalMin; cycle++) {
    const template = CYCLE_TEMPLATES[Math.min(cycle, CYCLE_TEMPLATES.length - 1)];
    for (const [stage, dur] of template) {
      if (t >= totalMin) break;
      const end = Math.min(totalMin, t + dur * scale);
      const prev = segments[segments.length - 1];
      if (prev && prev.stage === stage && prev.cycle === cycle) prev.end = end;
      else segments.push({ stage, start: t, end, cycle });
      t = end;
    }
  }
  return segments;
}

export type WindowKind = 'onset' | 'deep' | 'rem' | 'dawn';

export interface CueWindow {
  kind: WindowKind;
  goals: Goal[];
  start: number;
  end: number;
  /** Segundos de silencio entre una pista y la siguiente. */
  gapSec: number;
  /** Multiplicador de volumen relativo al volumen de sueño. */
  level: number;
}

export const WINDOW_LABELS: Record<WindowKind, string> = {
  onset: 'Al dormirte (hipnagogia)',
  deep: 'Sueño profundo',
  rem: 'Sueño REM',
  dawn: 'Antes de despertar',
};

/** Qué ventanas usa cada objetivo. */
export const GOAL_WINDOWS: Record<Goal, WindowKind[]> = {
  review: ['deep'],
  mantra: ['onset', 'dawn'],
  dream: ['onset', 'rem'],
};

const GAP_SEC: Record<WindowKind, number> = {
  onset: 25,
  deep: 8,
  rem: 40,
  dawn: 30,
};

const LEVEL: Record<WindowKind, number> = {
  onset: 1,
  deep: 1,
  rem: 0.7,
  dawn: 0.8,
};

export interface PlanOptions extends SleepParams {
  goals: Goal[];
  /** Cuántos ciclos iniciales reciben repaso en N3. */
  deepCycles?: number;
  /** Se pide hora de despertar: activa la ventana del amanecer. */
  hasWakeTime?: boolean;
}

/**
 * Ventanas en las que se reproducen pistas. Se dejan márgenes dentro de cada
 * fase porque la estimación tiene error y porque los cambios de fase son los
 * momentos en que es más fácil despertarse.
 */
export function planWindows(opts: PlanOptions): CueWindow[] {
  const { goals, deepCycles = 3, hasWakeTime = false } = opts;
  const wanted = new Set<WindowKind>();
  for (const g of goals) for (const k of GOAL_WINDOWS[g]) wanted.add(k);
  const goalsFor = (k: WindowKind) => goals.filter((g) => GOAL_WINDOWS[g].includes(k));
  const make = (kind: WindowKind, start: number, end: number): CueWindow => ({
    kind,
    goals: goalsFor(kind),
    start,
    end,
    gapSec: GAP_SEC[kind],
    level: LEVEL[kind],
  });

  const hyp = estimateHypnogram(opts);
  const windows: CueWindow[] = [];

  if (wanted.has('onset')) {
    // Desde que te acuestas hasta poco después de dormirte, bajando el volumen.
    const end = Math.min(opts.totalMin, opts.latencyMin + 10);
    if (end > 1) windows.push(make('onset', 0.5, end));
  }

  if (wanted.has('deep')) {
    for (const s of hyp) {
      if (s.stage !== 'N3' || s.cycle >= deepCycles) continue;
      const start = s.start + 5;
      const end = s.end - 3;
      if (end - start >= 5) windows.push(make('deep', start, end));
    }
  }

  if (wanted.has('rem')) {
    for (const s of hyp) {
      // Los REM tempranos son cortos; los de la segunda mitad de la noche son
      // más largos y con sueños más vívidos.
      if (s.stage !== 'REM' || s.cycle < 2) continue;
      const start = s.start + 5;
      const end = s.end - 2;
      if (end - start >= 5) windows.push(make('rem', start, end));
    }
  }

  if (wanted.has('dawn') && hasWakeTime && opts.totalMin > 60) {
    const start = Math.max(opts.totalMin - 20, 0);
    const end = opts.totalMin - 1;
    // Evita solaparse con una ventana REM tardía: la del amanecer tiene prioridad.
    for (const w of windows) {
      if (w.kind === 'rem' && w.end > start) w.end = start;
    }
    windows.push(make('dawn', start, end));
  }

  return windows.filter((w) => w.end - w.start >= 1).sort((a, b) => a.start - b.start);
}

/**
 * Envolvente de volumen (0-1) dentro de una ventana. Las ventanas de sueño
 * suben lentamente y bajan al final; la de inicio desciende mientras te duermes;
 * la del amanecer crece hacia la hora de despertar.
 */
export function windowEnvelope(w: CueWindow, t: number): number {
  if (t < w.start || t > w.end) return 0;
  const len = w.end - w.start;
  const pos = t - w.start;
  switch (w.kind) {
    case 'onset':
      return Math.max(0.15, 1 - pos / len);
    case 'dawn':
      return 0.4 + 0.6 * (pos / len);
    default: {
      const rampIn = Math.min(4, len / 3);
      const rampOut = Math.min(2, len / 4);
      if (pos < rampIn) return 0.25 + 0.75 * (pos / rampIn);
      if (len - pos < rampOut) return 0.25 + 0.75 * ((len - pos) / rampOut);
      return 1;
    }
  }
}

export function activeWindow(windows: CueWindow[], t: number): CueWindow | null {
  return windows.find((w) => t >= w.start && t < w.end) ?? null;
}

export function stageAt(hyp: StageSegment[], t: number): Stage | null {
  return hyp.find((s) => t >= s.start && t < s.end)?.stage ?? null;
}

/** Minutos desde `from` hasta la próxima hora "HH:MM" (al día siguiente si ya pasó). */
export function minutesUntil(hhmm: string, from: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const target = new Date(from);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (target.getTime() <= from.getTime()) target.setDate(target.getDate() + 1);
  return (target.getTime() - from.getTime()) / 60000;
}

/** Hora de despertar que cae al final de un ciclo (cuando es más fácil levantarse). */
export function suggestWakeTimes(from: Date, latencyMin: number, cycleMin: number, cycles = [4, 5, 6]): Date[] {
  return cycles.map((n) => new Date(from.getTime() + (latencyMin + n * cycleMin) * 60000));
}

/** Volumen 0-100 a ganancia lineal, en escala logarítmica (0 = silencio, 100 = 0 dB). */
export function volumeToGain(v: number): number {
  if (v <= 0) return 0;
  const db = (Math.min(100, v) - 100) * 0.6; // 100 → 0 dB, 1 → -59 dB
  return Math.pow(10, db / 20);
}
