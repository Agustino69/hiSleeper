import type { CSSProperties, ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Control segmentado con indicador que se desliza hasta la opción elegida. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (v: T) => void;
  label?: string;
}) {
  const i = options.findIndex((o) => o.value === value);
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': Math.max(0, i) } as CSSProperties}>
      {i >= 0 && <span className="seg-thumb" aria-hidden />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}
