import {
  activeWindow,
  estimateHypnogram,
  planWindows,
  stageAt,
  volumeToGain,
  windowEnvelope,
  WINDOW_LABELS,
  type CueWindow,
  type Stage,
  type StageSegment,
} from './schedule';
import type { CueSoundId, Goal, NightEventType, NightLog, Program, Track } from './types';

export type PlayItem =
  | { type: 'cue'; cue: CueSoundId; programId: string; label: string }
  | { type: 'track'; track: Track; programId: string; label: string };

/**
 * Lista de reproducción de cada programa. En repaso, el sonido firma va antes
 * de cada pista (es la señal que reactiva lo estudiado).
 */
export function buildPlaylist(program: Program, tracks: Map<string, Track>): PlayItem[] {
  const items: PlayItem[] = [];
  const cue: PlayItem | null = program.cue
    ? { type: 'cue', cue: program.cue, programId: program.id, label: `${program.name} · señal` }
    : null;
  const ts = program.trackIds
    .map((id) => tracks.get(id))
    .filter((t): t is Track => !!t)
    .map<PlayItem>((track) => ({ type: 'track', track, programId: program.id, label: `${program.name} · ${track.name}` }));
  if (program.goal === 'review') {
    if (!ts.length && cue) return [cue];
    for (const t of ts) {
      if (cue) items.push(cue);
      items.push(t);
    }
    return items;
  }
  if (cue) items.push(cue);
  return items.concat(ts);
}

export interface Player {
  playCue(id: CueSoundId, gain: number): Promise<void>;
  playTrack(track: Track, gain: number): Promise<void>;
  stopCues(): void;
}

export interface RunnerState {
  t: number;
  total: number;
  stage: Stage | null;
  window: CueWindow | null;
  nextWindow: CueWindow | null;
  pausedUntil: number | null;
  nowPlaying: string | null;
  cuesPlayed: number;
  finished: boolean;
}

export interface RunnerOptions {
  log: NightLog;
  programs: Program[];
  tracks: Map<string, Track>;
  player: Player;
  now?: () => number;
  onState?: (s: RunnerState) => void;
  onFinish?: () => void;
  onLogChange?: (log: NightLog) => void;
}

export class NightRunner {
  readonly windows: CueWindow[];
  readonly hypnogram: StageSegment[];
  private playlists = new Map<Goal, PlayItem[][]>();
  private cursor = new Map<string, number>();
  private goalTurn = 0;
  private busy = false;
  private nextAt = 0;
  private pausedUntil: number | null = null;
  /** Se reduce cada vez que hay movimiento: la noche se adapta a ti. */
  private adapt = 1;
  private lastWindow: CueWindow | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nowPlaying: string | null = null;
  private cuesPlayed = 0;
  private finished = false;
  private now: () => number;

  constructor(private opts: RunnerOptions) {
    this.now = opts.now ?? Date.now;
    const { log, programs, tracks } = opts;
    const s = log.settings;
    const goals = [...new Set(programs.map((p) => p.goal))];
    const params = { latencyMin: s.latencyMin, cycleMin: s.cycleMin, totalMin: log.totalMin };
    this.hypnogram = estimateHypnogram(params);
    this.windows = planWindows({ ...params, goals, deepCycles: s.deepCycles, hasWakeTime: !!s.wakeTime });
    for (const p of programs) {
      const list = buildPlaylist(p, tracks);
      if (!list.length) continue;
      const arr = this.playlists.get(p.goal) ?? [];
      arr.push(list);
      this.playlists.set(p.goal, arr);
    }
    this.cuesPlayed = log.events.filter((e) => e.type === 'cue').length;
  }

  get minutes(): number {
    return (this.now() - this.opts.log.startedAt) / 60000;
  }

  start() {
    if (!this.opts.log.events.length) this.event('start', 'Inicio de la sesión');
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.opts.player.stopCues();
  }

  /** Pausa manual (p. ej. te despertaste a media noche). */
  pause(minutes: number, reason = 'Pausa manual') {
    this.pausedUntil = this.now() + minutes * 60000;
    this.opts.player.stopCues();
    this.event('pause', `${reason} (${minutes} min)`);
    this.emit();
  }

  resume() {
    if (this.pausedUntil == null) return;
    this.pausedUntil = null;
    this.event('resume', 'Reanudado');
    this.emit();
  }

  onMotion(intensity: number, pauseMin: number) {
    this.event('motion', `Movimiento (${intensity.toFixed(2)})`);
    this.adapt = Math.max(0.5, this.adapt * 0.85);
    const w = activeWindow(this.windows, this.minutes);
    if (w && w.kind !== 'onset') this.pause(pauseMin, 'Movimiento detectado');
  }

  async tick() {
    const t = this.minutes;
    const total = this.opts.log.totalMin;
    if (this.finished) return;
    if (t >= total) {
      this.finished = true;
      this.stop();
      this.event('end', 'Fin de la noche');
      this.emit();
      this.opts.onFinish?.();
      return;
    }
    const w = activeWindow(this.windows, t);
    if (w !== this.lastWindow) {
      if (w) {
        this.event('window', `Ventana: ${WINDOW_LABELS[w.kind]}`);
        this.adapt = Math.min(1, this.adapt + 0.05);
      }
      this.lastWindow = w;
    }
    if (this.pausedUntil != null && this.now() >= this.pausedUntil) {
      this.pausedUntil = null;
      this.event('resume', 'Fin de la pausa');
    }
    this.emit();
    if (!w || this.busy || this.pausedUntil != null || this.now() < this.nextAt) return;

    const item = this.nextItem(w);
    if (!item) return;
    const s = this.opts.log.settings;
    const base = w.kind === 'onset' ? volumeToGain(s.onsetVolume) : volumeToGain(s.cueVolume);
    const gain = base * w.level * windowEnvelope(w, t) * this.adapt;
    this.busy = true;
    this.nowPlaying = item.label;
    this.emit();
    try {
      if (item.type === 'cue') await this.opts.player.playCue(item.cue, gain);
      else await this.opts.player.playTrack(item.track, gain);
      this.cuesPlayed++;
      this.event('cue', item.label);
    } catch (err) {
      this.event('pause', `Error al reproducir ${item.label}: ${(err as Error).message}`);
    } finally {
      this.busy = false;
      this.nowPlaying = null;
      // Intervalos con algo de variación: un patrón rígido se vuelve predecible
      // y el cerebro dormido lo filtra (habituación).
      const jitter = 0.8 + Math.random() * 0.4;
      this.nextAt = this.now() + w.gapSec * 1000 * jitter;
      this.emit();
    }
  }

  /** Alterna entre objetivos y entre programas dentro de una ventana. */
  private nextItem(w: CueWindow): PlayItem | null {
    const goals = w.goals.filter((g) => this.playlists.get(g)?.length);
    if (!goals.length) return null;
    const goal = goals[this.goalTurn++ % goals.length];
    const lists = this.playlists.get(goal)!;
    const key = `${goal}`;
    const c = this.cursor.get(key) ?? 0;
    this.cursor.set(key, c + 1);
    const list = lists[c % lists.length];
    const ik = `${goal}:${list[0].programId}`;
    const i = this.cursor.get(ik) ?? 0;
    this.cursor.set(ik, i + 1);
    return list[i % list.length];
  }

  private event(type: NightEventType, label: string) {
    this.opts.log.events.push({ t: Math.round(this.minutes * 100) / 100, type, label });
    this.opts.onLogChange?.(this.opts.log);
  }

  private emit() {
    const t = this.minutes;
    this.opts.onState?.({
      t,
      total: this.opts.log.totalMin,
      stage: stageAt(this.hypnogram, t),
      window: activeWindow(this.windows, t),
      nextWindow: this.windows.find((w) => w.start > t) ?? null,
      pausedUntil: this.pausedUntil,
      nowPlaying: this.nowPlaying,
      cuesPlayed: this.cuesPlayed,
      finished: this.finished,
    });
  }
}
