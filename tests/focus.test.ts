import { describe, expect, it } from 'vitest';
import { activeFocusWindow, DEFAULT_FOCUS, scheduleWindows, sessionWindows, StepDetector, type FocusConfig } from '../src/lib/focus';

const cfg: FocusConfig = { ...DEFAULT_FOCUS, enabled: true, bedtime: '23:00', windDownMin: 30, wakeTime: '07:00', morningMaxMin: 60 };
const t = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();

describe('scheduleWindows', () => {
  const from = new Date(2026, 9, 21, 12, 0); // miércoles 21/10, mediodía
  const ws = scheduleWindows(cfg, from, 3);

  it('noche: desde la desconexión previa hasta despertar, cruzando la medianoche', () => {
    const night = ws.find((w) => w.id === 'night-2026-10-22')!;
    expect(night.start).toBe(t(2026, 9, 21, 22, 30));
    expect(night.end).toBe(t(2026, 9, 22, 7));
  });

  it('mañana: desde despertar hasta el tope de seguridad', () => {
    const m = ws.find((w) => w.id === 'morning-2026-10-22')!;
    expect(m.start).toBe(t(2026, 9, 22, 7));
    expect(m.end).toBe(t(2026, 9, 22, 8));
  });

  it('descarta ventanas ya terminadas', () => {
    expect(ws.some((w) => w.id === 'night-2026-10-21')).toBe(false);
    expect(ws.every((w) => w.end > from.getTime())).toBe(true);
  });

  it('respeta los días elegidos (día del despertar)', () => {
    const weekdays = scheduleWindows({ ...cfg, days: [1, 2, 3, 4, 5] }, from, 7);
    const wakeDays = weekdays.filter((w) => w.kind === 'morning').map((w) => new Date(w.start).getDay());
    expect(wakeDays.every((d) => d >= 1 && d <= 5)).toBe(true);
    // El sábado por la mañana no hay bloqueo, así que el viernes por la noche tampoco.
    expect(weekdays.some((w) => w.id === 'night-2026-10-24')).toBe(false);
  });

  it('acostarse después de medianoche cae el mismo día del despertar', () => {
    const late = scheduleWindows({ ...cfg, bedtime: '00:30', windDownMin: 0 }, from, 2);
    const night = late.find((w) => w.id === 'night-2026-10-22')!;
    expect(night.start).toBe(t(2026, 9, 22, 0, 30));
  });

  it('sin bloqueo matutino solo hay ventanas de noche', () => {
    expect(scheduleWindows({ ...cfg, morningLock: false }, from, 3).every((w) => w.kind === 'night')).toBe(true);
  });

  it('horas inválidas no generan ventanas', () => {
    expect(scheduleWindows({ ...cfg, wakeTime: '' }, from)).toEqual([]);
  });
});

describe('activeFocusWindow', () => {
  const ws = [...scheduleWindows(cfg, new Date(2026, 9, 21, 12), 2), ...sessionWindows(cfg, 'n1', t(2026, 9, 21, 21), t(2026, 9, 22, 6, 30))];

  it('fuera de horario no bloquea', () => {
    expect(activeFocusWindow(ws, t(2026, 9, 21, 15))).toBeNull();
  });

  it('una sesión nocturna amplía el bloqueo antes del horario', () => {
    expect(activeFocusWindow(ws, t(2026, 9, 21, 21, 30))?.id).toBe('session-night-n1');
  });

  it('la mañana tiene prioridad y se desbloquea con el reto', () => {
    const now = t(2026, 9, 22, 7, 10);
    expect(activeFocusWindow(ws, now)?.kind).toBe('morning');
    expect(activeFocusWindow(ws, now, ['session-morning-n1', 'morning-2026-10-22'])).toBeNull();
  });

  it('al terminar la sesión antes de la alarma empieza su propia mañana', () => {
    const now = t(2026, 9, 22, 6, 45);
    expect(activeFocusWindow(ws, now)?.id).toBe('session-morning-n1');
  });
});

describe('StepDetector', () => {
  const walk = (seconds: number, hz: number, amp: number, noise = 0) => {
    const d = new StepDetector();
    for (let i = 0; i < seconds * 60; i++) {
      const tt = (i / 60) * 1000;
      const z = 9.81 + amp * Math.max(0, Math.sin(2 * Math.PI * hz * (i / 60))) + noise * (Math.random() - 0.5);
      d.push(0.3, 0.2, z, tt);
    }
    return d.count;
  };

  it('cuenta pasos al caminar (~2 pasos por segundo)', () => {
    const n = walk(10, 2, 4);
    expect(n).toBeGreaterThanOrEqual(18);
    expect(n).toBeLessThanOrEqual(21);
  });

  it('no cuenta pasos con el móvil quieto o con temblor leve', () => {
    expect(walk(10, 2, 0, 0.6)).toBe(0);
  });

  it('ignora sacudidas más rápidas que un paso humano', () => {
    expect(walk(5, 8, 4)).toBeLessThanOrEqual(5 * 1000 / 280 + 1);
  });
});

describe('fin de la sesión nocturna', async () => {
  const { endedSessionWindows } = await import('../src/lib/focusBridge');
  const log = { id: 'n9', startedAt: t(2026, 9, 21, 23), totalMin: 480, programIds: [], settings: {} as never, events: [] };

  it('cancelarla al poco de empezar no activa el bloqueo matutino', () => {
    expect(endedSessionWindows(cfg, log, t(2026, 9, 21, 23, 20))).toEqual([]);
  });

  it('despertar antes de la alarma adelanta la mañana', () => {
    const ws = endedSessionWindows(cfg, log, t(2026, 9, 22, 5, 30));
    expect(ws.find((w) => w.kind === 'morning')?.start).toBe(t(2026, 9, 22, 5, 30));
  });

  it('terminar después de la hora prevista no alarga la noche', () => {
    const ws = endedSessionWindows(cfg, log, t(2026, 9, 22, 9));
    expect(ws.find((w) => w.kind === 'night')?.end).toBe(t(2026, 9, 22, 7));
  });

  it('sin bloqueo activado no hay ventanas', () => {
    expect(endedSessionWindows({ ...cfg, enabled: false }, log, t(2026, 9, 22, 5))).toEqual([]);
  });
});
