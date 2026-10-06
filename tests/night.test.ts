import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/db';
import { buildPlaylist, NightRunner, type Player } from '../src/lib/night';
import type { NightLog, Program, Track } from '../src/lib/types';

const track: Track = { id: 't1', name: 'Resumen', kind: 'tts', text: 'hola', createdAt: 0 };
const tracks = new Map([[track.id, track]]);
const review: Program = {
  id: 'p1', name: 'Biología', goal: 'review', cue: 'cuenco', trackIds: ['t1', 'missing'],
  notes: '', enabled: true, createdAt: 0,
};

function setup(programs: Program[], startOffsetMin = 0) {
  let now = 1_000_000;
  const played: Array<{ what: string; gain: number }> = [];
  const player: Player = {
    playCue: vi.fn(async (id, gain) => void played.push({ what: id, gain })),
    playTrack: vi.fn(async (t, gain) => void played.push({ what: t.name, gain })),
    stopCues: vi.fn(),
  };
  const log: NightLog = {
    id: 'n', startedAt: now - startOffsetMin * 60000, totalMin: 480, programIds: programs.map((p) => p.id),
    settings: { ...DEFAULT_SETTINGS, wakeTime: '07:00' }, events: [],
  };
  const runner = new NightRunner({ log, programs, tracks, player, now: () => now });
  return { runner, played, log, player, advance: (sec: number) => (now += sec * 1000) };
}

describe('buildPlaylist', () => {
  it('en repaso intercala la señal antes de cada pista e ignora pistas borradas', () => {
    expect(buildPlaylist(review, tracks).map((i) => i.type)).toEqual(['cue', 'track']);
  });
  it('sin pistas, la señal sola', () => {
    expect(buildPlaylist({ ...review, trackIds: [] }, tracks)).toHaveLength(1);
  });
});

describe('NightRunner', () => {
  it('no reproduce nada fuera de las ventanas', async () => {
    const { runner, played } = setup([review], 5);
    await runner.tick();
    expect(played).toHaveLength(0);
  });

  it('reproduce en sueño profundo respetando el intervalo', async () => {
    const deepStart = 20 + 25 + 5; // latencia + N1/N2 + margen
    const { runner, played, advance } = setup([review], deepStart + 10);
    await runner.tick();
    await runner.tick();
    expect(played).toHaveLength(1);
    advance(20);
    await runner.tick();
    expect(played.map((p) => p.what)).toEqual(['cuenco', 'Resumen']);
    expect(played[0].gain).toBeGreaterThan(0);
    expect(played[0].gain).toBeLessThan(0.1);
  });

  it('el movimiento pausa y baja el volumen', async () => {
    const { runner, played, advance, log } = setup([review], 60);
    await runner.tick();
    const g0 = played[0].gain;
    runner.onMotion(1, 5);
    advance(60);
    await runner.tick();
    expect(played).toHaveLength(1);
    advance(5 * 60);
    await runner.tick();
    expect(played).toHaveLength(2);
    expect(played[1].gain).toBeLessThan(g0);
    expect(log.events.some((e) => e.type === 'motion')).toBe(true);
  });

  it('termina al llegar la hora', async () => {
    const onFinish = vi.fn();
    const { runner, advance } = setup([review], 479.99);
    (runner as unknown as { opts: { onFinish: () => void } }).opts.onFinish = onFinish;
    advance(5);
    await runner.tick();
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
