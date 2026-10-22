import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../lib/haptics';
import { project, releaseVelocity, rubberband, Spring, SPRING } from '../lib/spring';

export interface SheetHandle {
  /** Cierra con la animación de salida y luego llama a onClose. */
  dismiss: () => void;
}

let openSheets = 0;
const progressBySheet = new Map<number, number>();
let nextId = 1;

/** La app de fondo se hunde un poco mientras hay una hoja abierta (como en iOS). */
function applyPushBack() {
  const p = Math.max(0, ...progressBySheet.values());
  const root = document.documentElement;
  root.style.setProperty('--sheet-p', p.toFixed(4));
  root.classList.toggle('sheet-open', openSheets > 0);
}

/**
 * Hoja inferior con física de resorte:
 * - entra y sale por el mismo camino (de abajo hacia abajo);
 * - la cabecera se arrastra 1:1 respetando dónde se agarró;
 * - hacia arriba resiste (rubber-band); al soltar se proyecta la inercia para
 *   decidir si se cierra, y el resorte arranca con la velocidad del dedo;
 * - se puede agarrar a mitad de cualquier animación.
 */
export function Sheet({
  title,
  onClose,
  children,
  size = 'auto',
  ref,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'auto' | 'full';
  ref?: Ref<SheetHandle>;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const spring = useRef<Spring | null>(null);
  const height = useRef(600);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const id = useRef(0);
  const reduced = useRef(prefersReducedMotion());

  const render = (y: number) => {
    const el = sheetRef.current;
    if (!el) return;
    const p = Math.max(0, Math.min(1, 1 - y / height.current));
    if (reduced.current) {
      el.style.opacity = String(p);
    } else {
      el.style.transform = `translate3d(0, ${y}px, 0)`;
    }
    if (scrimRef.current) scrimRef.current.style.opacity = String(p);
    progressBySheet.set(id.current, p);
    applyPushBack();
  };

  const dismiss = (velocity = 0) => {
    const s = spring.current;
    if (!s) return onCloseRef.current();
    closing.current = true;
    s.to(height.current, SPRING.dismiss, velocity, () => onCloseRef.current());
  };

  useImperativeHandle(ref, () => ({ dismiss: () => dismiss() }), []);

  useLayoutEffect(() => {
    id.current = nextId++;
    openSheets++;
    // El origen del «hundimiento» es el centro de lo que se ve ahora.
    document.documentElement.style.setProperty('--sheet-origin', `${window.scrollY + window.innerHeight / 2}px`);
    height.current = sheetRef.current?.offsetHeight ?? 600;
    spring.current = new Spring(height.current, render);
    render(height.current);
    spring.current.to(0, SPRING.default);
    return () => {
      spring.current?.stop();
      openSheets--;
      progressBySheet.delete(id.current);
      applyPushBack();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Arrastre desde la cabecera.
  const drag = useRef<{ startY: number; startValue: number; samples: Array<{ y: number; t: number }>; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const s = spring.current;
    if (!s) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* puntero sintético o ya liberado */
    }
    // Se parte del valor que hay en pantalla, aunque estuviera animándose (interrumpible).
    s.stop();
    closing.current = false;
    height.current = sheetRef.current?.offsetHeight ?? height.current;
    drag.current = { startY: e.clientY, startValue: s.value, samples: [{ y: s.value, t: e.timeStamp }], moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    let y = d.startValue + dy;
    if (y < 0) y = -rubberband(-y, height.current);
    spring.current!.set(y);
    d.samples.push({ y, t: e.timeStamp });
    if (d.samples.length > 12) d.samples.shift();
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const s = spring.current;
    if (!d || !s) return;
    if (!d.moved) {
      // Un toque sin arrastre no cambia nada; si estaba a medias, termina de abrir.
      if (s.value !== 0) s.to(0, SPRING.default);
      return;
    }
    const v = releaseVelocity(d.samples);
    const projected = s.value + project(v);
    // Decide la inercia, no solo la posición: un gesto rápido hacia abajo cierra.
    if (projected > height.current * 0.5 && v > -50) dismiss(v);
    else s.to(0, Math.abs(v) > 300 ? SPRING.sheet : SPRING.default, v);
  };

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-scrim" ref={scrimRef} onClick={() => dismiss()} />
      <section className={`sheet ${size === 'full' ? 'sheet-full' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={sheetRef}>
        <header
          className="sheet-head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet-grabber" aria-hidden />
          <h2>{title}</h2>
          <button className="ghost icon close" onClick={() => dismiss()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
