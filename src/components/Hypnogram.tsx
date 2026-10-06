import type { CueWindow, Stage, StageSegment } from '../lib/schedule';
import { WINDOW_LABELS } from '../lib/schedule';

const LEVEL: Record<Stage, number> = { wake: 0, REM: 1, N1: 2, N2: 3, N3: 4 };
const STAGE_LABEL = ['Despierto', 'REM', 'N1', 'N2', 'N3'];
const WINDOW_COLOR: Record<CueWindow['kind'], string> = {
  onset: 'var(--c-onset)',
  deep: 'var(--c-deep)',
  rem: 'var(--c-rem)',
  dawn: 'var(--c-dawn)',
};

interface Props {
  hypnogram: StageSegment[];
  windows: CueWindow[];
  totalMin: number;
  start: Date;
  nowMin?: number;
}

export function Hypnogram({ hypnogram, windows, totalMin, start, nowMin }: Props) {
  const W = 640;
  const H = 170;
  const left = 62;
  const right = 8;
  const top = 8;
  const rowH = 22;
  const bandY = top + rowH * 4 + 18;
  const x = (m: number) => left + (m / totalMin) * (W - left - right);
  const y = (s: Stage) => top + LEVEL[s] * rowH;

  let d = '';
  for (const s of hypnogram) {
    d += `${d ? 'L' : 'M'}${x(s.start).toFixed(1)},${y(s.stage)}L${x(s.end).toFixed(1)},${y(s.stage)}`;
  }

  const ticks: number[] = [];
  const first = 60 - start.getMinutes();
  for (let m = first; m < totalMin; m += 60) ticks.push(m);
  const step = Math.max(1, Math.ceil(ticks.length / 7));
  const kinds = [...new Set(windows.map((w) => w.kind))];

  return (
    <figure className="hypno">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estimación de fases de sueño y momentos de reproducción">
        {STAGE_LABEL.map((l, i) => (
          <g key={l}>
            <line x1={left} x2={W - right} y1={top + i * rowH} y2={top + i * rowH} className="grid" />
            <text x={left - 6} y={top + i * rowH + 4} className="axis" textAnchor="end">
              {l}
            </text>
          </g>
        ))}
        {windows.map((w, i) => (
          <rect
            key={i}
            x={x(w.start)}
            width={Math.max(2, x(w.end) - x(w.start))}
            y={top - 4}
            height={rowH * 4 + 8}
            fill={WINDOW_COLOR[w.kind]}
            opacity={0.18}
            rx={3}
          />
        ))}
        <path d={d} className="stage-line" />
        {windows.map((w, i) => (
          <rect key={`b${i}`} x={x(w.start)} width={Math.max(2, x(w.end) - x(w.start))} y={bandY} height={8} rx={2} fill={WINDOW_COLOR[w.kind]} />
        ))}
        {ticks.filter((_, i) => i % step === 0).map((m) => (
          <text key={m} x={x(m)} y={H - 4} className="axis" textAnchor="middle">
            {new Date(start.getTime() + m * 60000).getHours()}h
          </text>
        ))}
        {nowMin != null && nowMin <= totalMin && (
          <line x1={x(nowMin)} x2={x(nowMin)} y1={top - 6} y2={bandY + 10} className="now-line" />
        )}
      </svg>
      {kinds.length > 0 && (
        <figcaption className="legend">
          {kinds.map((k) => (
            <span key={k}>
              <i style={{ background: WINDOW_COLOR[k] }} />
              {WINDOW_LABELS[k]}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
