/**
 * «Sin pantallas en la cama»: bloqueo de apps a la hora de dormir y al despertar.
 *
 * La app calcula aquí las ventanas de bloqueo (fechas concretas para los
 * próximos días) y se las pasa al servicio nativo de Android, que solo tiene que
 * comprobar si «ahora» cae dentro de alguna. Así toda la lógica de horarios vive
 * en un solo sitio y está cubierta por tests.
 */

export type FocusChallenge = 'steps' | 'journal';

export interface FocusConfig {
  enabled: boolean;
  /** Paquetes de Android bloqueados (com.instagram.android…). */
  packages: string[];
  /** Hora de acostarse "HH:MM". */
  bedtime: string;
  /** El bloqueo empieza estos minutos antes de acostarse. */
  windDownMin: number;
  /** Hora de despertar "HH:MM". */
  wakeTime: string;
  /** Días (0 = domingo) en los que te despiertas con el bloqueo activo. */
  days: number[];
  /** Mantener el bloqueo al despertar hasta superar el reto. */
  morningLock: boolean;
  challenge: FocusChallenge;
  steps: number;
  journalChars: number;
  /** Tope de seguridad: el bloqueo matutino nunca dura más de esto. */
  morningMaxMin: number;
  /** true = fricción (se puede abrir tras esperar); false = estricto. */
  allowOverride: boolean;
  overrideDelaySec: number;
  overrideMin: number;
}

export const DEFAULT_FOCUS: FocusConfig = {
  enabled: false,
  packages: [],
  bedtime: '23:00',
  windDownMin: 30,
  wakeTime: '07:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  morningLock: true,
  challenge: 'steps',
  steps: 40,
  journalChars: 60,
  morningMaxMin: 60,
  allowOverride: true,
  overrideDelaySec: 20,
  overrideMin: 5,
};

export type FocusKind = 'night' | 'morning';

export interface FocusWindow {
  id: string;
  kind: FocusKind;
  start: number;
  end: number;
}

function parseHM(hm: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function at(day: Date, hm: [number, number]): Date {
  const d = new Date(day);
  d.setHours(hm[0], hm[1], 0, 0);
  return d;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Ventanas del horario para los próximos `horizonDays` días (en hora local, con cambios de horario). */
export function scheduleWindows(cfg: FocusConfig, from: Date, horizonDays = 14): FocusWindow[] {
  const wake = parseHM(cfg.wakeTime);
  const bed = parseHM(cfg.bedtime);
  if (!wake || !bed) return [];
  const out: FocusWindow[] = [];
  for (let d = -1; d <= horizonDays; d++) {
    const day = new Date(from);
    day.setDate(day.getDate() + d);
    if (!cfg.days.includes(day.getDay())) continue;
    const wakeAt = at(day, wake);
    // Si la hora de dormir es posterior a la de despertar (lo habitual), fue la noche anterior.
    const bedDay = new Date(day);
    if (bed[0] * 60 + bed[1] >= wake[0] * 60 + wake[1]) bedDay.setDate(bedDay.getDate() - 1);
    const nightStart = at(bedDay, bed).getTime() - cfg.windDownMin * 60000;
    const key = dayKey(day);
    out.push({ id: `night-${key}`, kind: 'night', start: nightStart, end: wakeAt.getTime() });
    if (cfg.morningLock) {
      out.push({ id: `morning-${key}`, kind: 'morning', start: wakeAt.getTime(), end: wakeAt.getTime() + cfg.morningMaxMin * 60000 });
    }
  }
  return out.filter((w) => w.end > from.getTime() && w.end > w.start);
}

/** Ventanas de una sesión nocturna concreta (se suman a las del horario). */
export function sessionWindows(cfg: FocusConfig, sessionId: string, start: number, end: number): FocusWindow[] {
  const ws: FocusWindow[] = [{ id: `session-night-${sessionId}`, kind: 'night', start, end }];
  if (cfg.morningLock) ws.push({ id: `session-morning-${sessionId}`, kind: 'morning', start: end, end: end + cfg.morningMaxMin * 60000 });
  return ws;
}

/** Ventana activa ahora. La mañana tiene prioridad: es la que se desbloquea con el reto. */
export function activeFocusWindow(windows: FocusWindow[], now: number, unlocked: string[] = []): FocusWindow | null {
  const active = windows.filter((w) => now >= w.start && now < w.end && !unlocked.includes(w.id));
  return active.find((w) => w.kind === 'morning') ?? active[0] ?? null;
}

/**
 * Apps que suelen alimentar el doomscrolling; se preseleccionan si están
 * instaladas. Nunca se incluyen teléfono, mensajes, reloj ni ajustes.
 */
export const SUGGESTED_PACKAGES = [
  'com.instagram.android',
  'com.instagram.barcelona', // Threads
  'com.zhiliaoapp.musically', // TikTok
  'com.ss.android.ugc.trill', // TikTok (Asia)
  'com.google.android.youtube',
  'com.facebook.katana',
  'com.facebook.lite',
  'com.twitter.android', // X
  'com.reddit.frontpage',
  'com.snapchat.android',
  'com.pinterest',
  'tv.twitch.android.app',
  'com.netflix.mediaclient',
  'com.linkedin.android',
  'com.tumblr',
  'org.telegram.messenger',
  'com.discord',
  'com.kwai.video',
  'com.bereal.ft',
];

/**
 * Detector de pasos con el acelerómetro: picos de la magnitud de la aceleración
 * por encima de su media móvil, con un periodo refractario entre pasos.
 */
export class StepDetector {
  private baseline = 9.81;
  private above = false;
  private lastStep = -Infinity;
  count = 0;

  constructor(
    private threshold = 1.3,
    private refractoryMs = 280,
  ) {}

  /** Devuelve true si esta muestra completa un paso. */
  push(x: number, y: number, z: number, t: number): boolean {
    const mag = Math.sqrt(x * x + y * y + z * z);
    this.baseline = 0.95 * this.baseline + 0.05 * mag;
    const d = mag - this.baseline;
    if (!this.above && d > this.threshold) {
      this.above = true;
      if (t - this.lastStep >= this.refractoryMs) {
        this.lastStep = t;
        this.count++;
        return true;
      }
    } else if (this.above && d < this.threshold * 0.3) {
      this.above = false;
    }
    return false;
  }
}
