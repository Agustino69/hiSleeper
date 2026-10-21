import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Título grande (como iOS) que, al desaparecer bajo el borde superior, deja una
 * barra compacta translucida con el mismo nombre: siempre sabes dónde estás.
 */
export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0), {
      rootMargin: '-8px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      {createPortal(
        <div className={`nav-compact ${compact ? 'on' : ''}`} aria-hidden>
          <span>{title}</span>
        </div>,
        document.body,
      )}
      <header className="screen-head">
        <h1 ref={ref} className="large-title">
          {title}
        </h1>
        {children}
      </header>
    </>
  );
}
