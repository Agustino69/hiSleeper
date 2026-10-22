/**
 * Modo dormir basado en el uso del teléfono (sin horarios fijos):
 *
 *   inactivo ──botón──▶ cuenta atrás ──▶ durmiendo ──primer desbloqueo tras el sueño mínimo──▶ mañana ──reto──▶ inactivo
 *
 * El estado vive en Android (funciona con la app cerrada: botón del panel rápido,
 * alarmas y servicio). Aquí está la configuración y los textos para la interfaz.
 */

export type FocusChallenge = 'steps' | 'journal';

export interface FocusConfig {
  enabled: boolean;
  /** Paquetes de Android en pausa (com.instagram.android…). */
  packages: string[];
  /** Cuenta atrás al pulsar «Modo dormir» antes de pausar las apps. */
  windDownMin: number;
  /** Desbloquear antes de este tiempo dormido no cuenta como despertar (ir al baño, mirar algo). */
  minSleepMin: number;
  challenge: FocusChallenge;
  steps: number;
  journalChars: number;
  /** Alarma si por la mañana la pantalla se queda apagada (volviste a la cama). */
  antiSnooze: boolean;
  snoozeMin: number;
  /** De noche: true = fricción (se puede abrir tras esperar); false = estricto. */
  allowOverride: boolean;
  overrideDelaySec: number;
  overrideMin: number;
}

export const DEFAULT_FOCUS: FocusConfig = {
  enabled: false,
  packages: [],
  windDownMin: 30,
  minSleepMin: 300,
  challenge: 'steps',
  steps: 40,
  journalChars: 60,
  antiSnooze: true,
  snoozeMin: 5,
  allowOverride: true,
  overrideDelaySec: 20,
  overrideMin: 5,
};

export type SleepPhase = 'idle' | 'wind_down' | 'sleep' | 'morning';

export interface SleepState {
  phase: SleepPhase;
  startedAt: number;
  /** Cuándo se pausan (o se pausaron) las apps. */
  sleepAt: number;
  morningAt: number;
  canGoBackToSleep: boolean;
}

export const IDLE_STATE: SleepState = { phase: 'idle', startedAt: 0, sleepAt: 0, morningAt: 0, canGoBackToSleep: false };

export type FocusKind = 'night' | 'morning';

/** «12:05» para una cuenta atrás. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Hora a partir de la cual desbloquear cuenta como despertar. */
export function wakeDetectionFrom(state: SleepState, cfg: FocusConfig): number {
  return state.sleepAt + cfg.minSleepMin * 60000;
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
