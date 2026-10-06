import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VoiceRecorder } from '../lib/device';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
  action?: ReactNode;
}) {
  const { label, value, min, max, step = 1, unit = '', hint, onChange, action } = props;
  return (
    <label className="field">
      <span className="field-row">
        <span>{label}</span>
        <b>
          {value}
          {unit}
        </b>
      </span>
      <span className="field-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {action}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

/** Botón de grabar/detener con contador. */
export function RecordButton({ onDone, label = 'Grabar' }: { onDone: (blob: Blob, sec: number) => void; label?: string }) {
  const rec = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [sec, setSec] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSec(Math.round((Date.now() - (rec.current?.startedAt ?? Date.now())) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => () => rec.current?.cancel(), []);

  async function toggle() {
    setError('');
    if (!recording) {
      try {
        rec.current = new VoiceRecorder();
        await rec.current.start();
        setSec(0);
        setRecording(true);
      } catch (e) {
        setError(`No se pudo usar el micrófono: ${(e as Error).message}`);
      }
      return;
    }
    const { blob, durationSec } = await rec.current!.stop();
    setRecording(false);
    onDone(blob, durationSec);
  }

  return (
    <div className="record">
      <button className={recording ? 'danger' : 'primary'} onClick={toggle}>
        {recording ? `■ Detener (${sec}s)` : `● ${label}`}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
