export type Goal = 'review' | 'mantra' | 'dream';

export type CueSoundId =
  | 'cuenco'
  | 'campana'
  | 'gota'
  | 'kalimba'
  | 'flauta'
  | 'cristal'
  | 'madera'
  | 'arpa';

export type NoiseType = 'none' | 'pink' | 'brown' | 'ocean' | 'white';

export type TrackKind = 'recording' | 'file' | 'tts';

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  /** Clave del blob de audio en IndexedDB (grabaciones y archivos). */
  blobKey?: string;
  mime?: string;
  /** Texto a sintetizar (pistas tts). */
  text?: string;
  ttsRate?: number;
  ttsVoice?: string;
  durationSec?: number;
  createdAt: number;
}

export interface Program {
  id: string;
  name: string;
  goal: Goal;
  /** Sonido firma: se asocia al contenido despierto y se repite dormido. */
  cue: CueSoundId | null;
  trackIds: string[];
  /** Repaso: apuntes/tarjetas. Sueño: intención. Mantra: texto del mantra. */
  notes: string;
  enabled: boolean;
  lastPreparedAt?: number;
  createdAt: number;
}

export interface NightSettings {
  /** Minutos que sueles tardar en dormirte. */
  latencyMin: number;
  /** Duración de un ciclo de sueño completo. */
  cycleMin: number;
  /** Hora de despertar "HH:MM" o '' si no hay. */
  wakeTime: string;
  /** Volumen máximo de las pistas durante el sueño (0-100). */
  cueVolume: number;
  /** Volumen de las pistas al acostarte, todavía despierto (0-100). */
  onsetVolume: number;
  noise: NoiseType;
  noiseVolume: number;
  /** 0 = desactivado, 1-5 sensibilidad del detector de movimiento. */
  motionSensitivity: number;
  /** Minutos de pausa tras detectar movimiento. */
  motionPauseMin: number;
  gentleAlarm: boolean;
  /** Ciclos (desde el primero) en que se reproduce repaso en sueño profundo. */
  deepCycles: number;
}

export type NightEventType = 'cue' | 'motion' | 'pause' | 'resume' | 'window' | 'start' | 'end';

export interface NightEvent {
  /** Minutos desde el inicio de la sesión. */
  t: number;
  type: NightEventType;
  label: string;
}

export interface NightLog {
  id: string;
  startedAt: number;
  endedAt?: number;
  totalMin: number;
  programIds: string[];
  settings: NightSettings;
  events: NightEvent[];
}

export interface JournalEntry {
  id: string;
  createdAt: number;
  nightLogId?: string;
  text: string;
  /** Grabación de voz del relato del sueño. */
  blobKey?: string;
  rememberedDream: boolean;
  /** 0 = nada, 1 = algo, 2 = claramente, 3 = sueño lúcido/totalmente. */
  incubationHit: number;
  quality: number;
}
