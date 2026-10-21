import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { db } from './db';
import { activeFocusWindow, DEFAULT_FOCUS, scheduleWindows, sessionWindows, type FocusConfig, type FocusKind, type FocusWindow } from './focus';
import { isNative } from './native';
import type { NightLog } from './types';

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

interface FocusPlugin {
  getStatus(): Promise<{ serviceEnabled: boolean; sdk: number }>;
  openAccessibilitySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  listApps(): Promise<{ apps: InstalledApp[] }>;
  setConfig(o: { enabled: boolean; packages: string[]; windows: FocusWindow[] }): Promise<void>;
  unlock(o: { ids: string[] }): Promise<void>;
  getUnlocked(): Promise<{ ids: string[] }>;
  allowTemporarily(o: { package: string; minutes: number }): Promise<void>;
  launchApp(o: { package: string }): Promise<void>;
  goHome(): Promise<void>;
  getAttempts(o: { since: number }): Promise<{ attempts: Attempt[] }>;
  addListener(event: 'blocked', cb: (e: BlockedEvent) => void): Promise<PluginListenerHandle>;
}

export const Focus = registerPlugin<FocusPlugin>('Focus');
export const focusSupported = isNative;

const CONFIG_KEY = 'focus';
const SESSION_KEY = 'focusSessionWindows';

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

async function sessionWins(): Promise<FocusWindow[]> {
  return ((await db.meta.get<FocusWindow[]>(SESSION_KEY)) ?? []).filter((w) => w.end > Date.now());
}

/** Todas las ventanas vigentes: horario de los próximos días + sesiones nocturnas. */
export async function currentWindows(cfg?: FocusConfig): Promise<FocusWindow[]> {
  const c = cfg ?? (await loadFocusConfig());
  return [...scheduleWindows(c, new Date()), ...(await sessionWins())];
}

/** Envía la configuración al servicio nativo. Se llama al abrir la app y tras cada cambio. */
export async function syncFocus(cfg?: FocusConfig): Promise<void> {
  if (!isNative) return;
  const c = cfg ?? (await loadFocusConfig());
  await Focus.setConfig({ enabled: c.enabled, packages: c.packages, windows: await currentWindows(c) }).catch(() => undefined);
}

/** La sesión nocturna también bloquea, aunque esté fuera del horario. */
export async function startFocusSession(log: NightLog): Promise<void> {
  const cfg = await loadFocusConfig();
  if (!cfg.enabled) return;
  const others = (await sessionWins()).filter((w) => !w.id.endsWith(log.id));
  await db.meta.set(SESSION_KEY, [...others, ...sessionWindows(cfg, log.id, log.startedAt, log.startedAt + log.totalMin * 60000)]);
  await syncFocus(cfg);
}

/** Por debajo de esto, terminar la sesión cuenta como cancelarla, no como despertar. */
export const CANCEL_SESSION_MIN = 180;

/**
 * Al terminar la sesión: si fue tras dormir un buen rato (despertaste antes de la
 * alarma), la mañana empieza ya; si fue al poco de empezar, se cancela su bloqueo
 * (el horario normal sigue aplicando).
 */
export function endedSessionWindows(cfg: FocusConfig, log: NightLog, at: number): FocusWindow[] {
  if (!cfg.enabled || at - log.startedAt < CANCEL_SESSION_MIN * 60000) return [];
  return sessionWindows(cfg, log.id, log.startedAt, Math.min(at, log.startedAt + log.totalMin * 60000));
}

export async function endFocusSession(log: NightLog, at = Date.now()): Promise<void> {
  const cfg = await loadFocusConfig();
  const others = (await sessionWins()).filter((w) => !w.id.endsWith(log.id));
  await db.meta.set(SESSION_KEY, [...others, ...endedSessionWindows(cfg, log, at)]);
  await syncFocus(cfg);
}

export async function unlockedIds(): Promise<string[]> {
  if (!isNative) return [];
  return (await Focus.getUnlocked().catch(() => ({ ids: [] }))).ids;
}

/** Ventana que bloquea ahora mismo (null si no hay bloqueo). */
export async function activeWindowNow(): Promise<FocusWindow | null> {
  const cfg = await loadFocusConfig();
  if (!isNative || !cfg.enabled) return null;
  return activeFocusWindow(await currentWindows(cfg), Date.now(), await unlockedIds());
}

/** Reto superado: se desbloquean todas las ventanas de mañana activas. */
export async function unlockMorningNow(): Promise<void> {
  const now = Date.now();
  const ids = (await currentWindows()).filter((w) => w.kind === 'morning' && now >= w.start && now < w.end).map((w) => w.id);
  if (ids.length && isNative) await Focus.unlock({ ids });
}

/** El reto «anotar mi sueño» se cumple al guardar una entrada del diario suficientemente larga. */
export async function onJournalSaved(text: string): Promise<boolean> {
  const cfg = await loadFocusConfig();
  if (!cfg.enabled || !cfg.morningLock || cfg.challenge !== 'journal') return false;
  if (text.trim().length < cfg.journalChars) return false;
  const w = await activeWindowNow();
  if (w?.kind !== 'morning') return false;
  await unlockMorningNow();
  return true;
}
