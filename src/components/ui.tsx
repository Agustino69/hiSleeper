import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { VoiceRecorder } from '../lib/device';

/** Porcentaje relleno de un slider (la pista se colorea hasta el pulgar). */
export const rangeFill = (v: number, min: number, max: number) => ({ '--fill': `${((v - min) / (max - min || 1)) * 100}%` }) as CSSProperties;

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
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={rangeFill(value, min, max)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {action}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export { Sheet } from './Sheet';
export type { SheetHandle } from './Sheet';

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
