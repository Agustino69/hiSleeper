/** Avisos breves no bloqueantes (estado, confirmación, deshacer). */

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  duration: number;
}

type Listener = (t: ToastData | null) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function toast(message: string, opts: { action?: ToastData['action']; duration?: number } = {}) {
  const t: ToastData = { id: ++seq, message, action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 3000) };
  listeners.forEach((l) => l(t));
}

export function subscribeToasts(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
