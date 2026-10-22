/**
 * Vibración solo en momentos con significado (completar, desbloquear, empezar
 * la noche). Si todo vibra, nada se nota.
 */
type Haptic = 'success' | 'commit' | 'warning';

const PATTERNS: Record<Haptic, number | number[]> = {
  success: [14, 60, 18],
  commit: 10,
  warning: [24, 50, 24],
};

export function haptic(kind: Haptic) {
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* sin vibración disponible */
  }
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
