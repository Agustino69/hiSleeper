import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { db } from './db';
import { DEFAULT_FOCUS, IDLE_STATE, type FocusConfig, type FocusKind, type SleepState } from './focus';
import { isNative } from './native';

export interface InstalledApp {
  package: string;
  label: string;
  icon?: string | null;
}

export interface BlockedEvent {
  package?: string;
  label?: string;
  kind: FocusKind;
  at: number;
}

export interface Attempt {
  package: string;
  label: string;
  kind: FocusKind;
  at: number;
}

export interface FocusStatus {
  /** «Acceso de uso»: saber qué app está en primer plano. */
  usageAccess: boolean;
  /** «Mostrar sobre otras apps»: abrir hiSleeper encima de la app en pausa. */
  overlay: boolean;
  /** Alarmas exactas: fin de la cuenta atrás y alarma anti-sueño puntuales. */
  exactAlarm: boolean;
  sdk: number;
}

interface NativeConfig {
  enabled: boolean;
  packages: string[];
  windDownMin: number;
  minSleepMin: number;
  snoozeMin: number;
  antiSnooze: boolean;
  steps: number;
  challenge: string;
}

interface FocusPlugin {
  getStatus(): Promise<FocusStatus>;
  openUsageAccessSettings(): Promise<void>;
  openOverlaySettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  requestAddTile(): Promise<{ supported: boolean; added?: boolean }>;
  listApps(): Promise<{ apps: InstalledApp[] }>;
  setConfig(o: NativeConfig): Promise<SleepState>;
  getState(): Promise<SleepState>;
  startSleep(o: { windDownMin: number }): Promise<SleepState>;
  cancelSleep(): Promise<SleepState>;
  backToSleep(): Promise<SleepState>;
  completeMorning(): Promise<SleepState>;
  allowTemporarily(o: { package: string; minutes: number }): Promise<void>;
  launchApp(o: { package: string }): Promise<void>;
  goHome(): Promise<void>;
  getAttempts(o: { since: number }): Promise<{ attempts: Attempt[] }>;
  addListener(event: 'blocked', cb: (e: BlockedEvent) => void): Promise<PluginListenerHandle>;
}

export const Focus = registerPlugin<FocusPlugin>('Focus');
export const focusSupported = isNative;

const CONFIG_KEY = 'focus';

export async function loadFocusConfig(): Promise<FocusConfig> {
  return { ...DEFAULT_FOCUS, ...((await db.meta.get<Partial<FocusConfig>>(CONFIG_KEY)) ?? {}) };
}

/** ¿El usuario ya guardó alguna vez la configuración? */
export async function isFocusConfigured(): Promise<boolean> {
  return (await db.meta.get(CONFIG_KEY)) !== undefined;
}

export async function saveFocusConfig(cfg: FocusConfig): Promise<void> {
  await db.meta.set(CONFIG_KEY, cfg);
  await syncFocus(cfg);
}

/** Envía la configuración al lado nativo (que funciona aunque la app esté cerrada). */
export async function syncFocus(cfg?: FocusConfig): Promise<void> {
  if (!isNative) return;
  const c = cfg ?? (await loadFocusConfig());
  await Focus.setConfig({
    enabled: c.enabled,
    packages: c.packages,
    windDownMin: c.windDownMin,
    minSleepMin: c.minSleepMin,
    snoozeMin: c.snoozeMin,
    antiSnooze: c.antiSnooze,
    steps: c.steps,
    challenge: c.challenge,
  }).catch(() => undefined);
}

const safe = async (p: () => Promise<SleepState>): Promise<SleepState> => {
  if (!isNative) return IDLE_STATE;
  try {
    return await p();
  } catch {
    return IDLE_STATE;
  }
};

export const getSleepState = () => safe(() => Focus.getState());
export const cancelSleep = () => safe(() => Focus.cancelSleep());
export const backToSleep = () => safe(() => Focus.backToSleep());
export const completeMorning = () => safe(() => Focus.completeMorning());

/** Empieza el modo dormir (si está activado y no estaba ya en marcha). */
export async function startSleep(windDownMin?: number): Promise<SleepState> {
  const cfg = await loadFocusConfig();
  if (!isNative || !cfg.enabled) return getSleepState();
  const current = await getSleepState();
  if (current.phase !== 'idle') return current;
  return safe(() => Focus.startSleep({ windDownMin: windDownMin ?? cfg.windDownMin }));
}

/** El reto «anotar mi sueño» se cumple al guardar una entrada del diario suficientemente larga. */
export async function onJournalSaved(text: string): Promise<boolean> {
  const cfg = await loadFocusConfig();
  if (!cfg.enabled || text.trim().length < cfg.journalChars) return false;
  if ((await getSleepState()).phase !== 'morning') return false;
  await completeMorning();
  return true;
}
