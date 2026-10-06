import type { Goal } from './types';

export const GOAL_INFO: Record<Goal, { label: string; icon: string; blurb: string }> = {
  review: {
    label: 'Repasar un tema',
    icon: '📚',
    blurb: 'Estudias con un sonido firma y ese sonido se repite en tu sueño profundo para reactivar el recuerdo.',
  },
  mantra: {
    label: 'Mantra / afirmación',
    icon: '🕯️',
    blurb: 'Tu voz te acompaña mientras te duermes y vuelve suavemente antes de despertar.',
  },
  dream: {
    label: 'Soñar con algo',
    icon: '🌙',
    blurb: 'Incubación: el tema suena al quedarte dormido y en los REM de la madrugada, cuando sueñas más.',
  },
};

export function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function isToday(ts?: number): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  const n = new Date();
  // "Hoy" para una noche: desde las 4:00 de la madrugada.
  const start = new Date(n);
  start.setHours(4, 0, 0, 0);
  if (n < start) start.setDate(start.getDate() - 1);
  return d >= start;
}
