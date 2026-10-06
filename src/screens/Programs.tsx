import { useState } from 'react';
import { engine } from '../lib/audio/engine';
import { CUE_SOUNDS } from '../lib/audio/synth';
import { db, uid } from '../lib/db';
import { fmtDate, GOAL_INFO, isToday } from '../lib/format';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { CueSoundId, Goal, Program } from '../lib/types';
import { Empty, Sheet } from '../components/ui';
import { PrepareScreen } from './Prepare';

const NOTES_LABEL: Record<Goal, { label: string; placeholder: string }> = {
  review: {
    label: 'Apuntes para estudiar (separa las tarjetas con una línea en blanco)',
    placeholder: 'Mitocondria: produce ATP por respiración celular.\n\nRibosoma: sintetiza proteínas.',
  },
  mantra: { label: 'Tu mantra o afirmación', placeholder: 'Estoy en calma. Confío en mí.' },
  dream: {
    label: 'Intención: qué quieres soñar (con detalles sensoriales)',
    placeholder: 'Vuelo sobre el mar al atardecer, siento el viento tibio y veo gaviotas a mi lado.',
  },
};

export function ProgramsScreen() {
  const { programs, refresh } = useStore();
  const [editing, setEditing] = useState<Program | null>(null);
  const [preparing, setPreparing] = useState<Program | null>(null);
  const [picking, setPicking] = useState(false);

  function create(goal: Goal) {
    const used = new Set(programs.map((p) => p.cue));
    const cue = CUE_SOUNDS.find((c) => !used.has(c.id))?.id ?? 'cuenco';
    setPicking(false);
    setEditing({
      id: uid(),
      name: '',
      goal,
      cue: goal === 'mantra' ? null : cue,
      trackIds: [],
      notes: '',
      enabled: true,
      createdAt: Date.now(),
    });
  }

  async function toggle(p: Program) {
    await db.programs.save({ ...p, enabled: !p.enabled });
    await refresh();
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Objetivos</h1>
        <p className="muted">Cada objetivo agrupa una señal sonora, tus pistas y lo que preparas antes de dormir.</p>
      </header>

      <button className="primary wide" onClick={() => setPicking(true)}>
        ＋ Nuevo objetivo
      </button>

      {programs.length === 0 ? (
        <Empty>Crea tu primer objetivo: un tema que repasar, un mantra o algo que quieras soñar.</Empty>
      ) : (
        <ul className="list">
          {programs.map((p) => (
            <li key={p.id} className={`card ${p.enabled ? '' : 'dim'}`}>
              <div className="row">
                <span className="goal-icon">{GOAL_INFO[p.goal].icon}</span>
                <div className="grow">
                  <b>{p.name}</b>
                  <small className="muted">
                    {GOAL_INFO[p.goal].label} · {p.trackIds.length} pista{p.trackIds.length === 1 ? '' : 's'}
                    {p.cue ? ` · señal: ${CUE_SOUNDS.find((c) => c.id === p.cue)?.label}` : ''}
                  </small>
                  <small className={isToday(p.lastPreparedAt) ? 'ok' : 'muted'}>
                    {isToday(p.lastPreparedAt)
                      ? '✓ Preparado hoy'
                      : p.lastPreparedAt
                        ? `Última preparación: ${fmtDate(p.lastPreparedAt)}`
                        : 'Sin preparar'}
                  </small>
                </div>
                <label className="switch" title="Usar esta noche">
                  <input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} />
                  <span />
                </label>
              </div>
              <div className="actions">
                <button className="primary" onClick={() => setPreparing(p)}>
                  {p.goal === 'review' ? 'Estudiar con la señal' : p.goal === 'dream' ? 'Visualizar' : 'Recitar'}
                </button>
                <button onClick={() => setEditing(p)}>Editar</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <Sheet title="¿Qué quieres lograr?" onClose={() => setPicking(false)}>
          <div className="goal-pick">
            {(Object.keys(GOAL_INFO) as Goal[]).map((g) => (
              <button key={g} className="card goal-option" onClick={() => create(g)}>
                <span className="goal-icon">{GOAL_INFO[g].icon}</span>
                <span>
                  <b>{GOAL_INFO[g].label}</b>
                  <small>{GOAL_INFO[g].blurb}</small>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {editing && <ProgramEditor program={editing} onClose={() => setEditing(null)} />}
      {preparing && <PrepareScreen program={preparing} onClose={() => setPreparing(null)} />}
    </div>
  );
}

function ProgramEditor({ program, onClose }: { program: Program; onClose: () => void }) {
  const { programs, tracks, refresh } = useStore();
  const [p, setP] = useState(program);
  const isNew = !programs.some((x) => x.id === p.id);
  const clash = p.cue && programs.find((x) => x.id !== p.id && x.cue === p.cue && x.goal === 'review' && p.goal === 'review');

  async function save() {
    await db.programs.save({ ...p, name: p.name.trim() || GOAL_INFO[p.goal].label });
    await refresh();
    onClose();
  }

  async function remove() {
    if (!confirm(`¿Borrar «${p.name}»? Las pistas se conservan.`)) return;
    await db.programs.remove(p.id);
    await refresh();
    onClose();
  }

  const toggleTrack = (id: string) =>
    setP((x) => ({ ...x, trackIds: x.trackIds.includes(id) ? x.trackIds.filter((t) => t !== id) : [...x.trackIds, id] }));

  return (
    <Sheet title={isNew ? `Nuevo: ${GOAL_INFO[p.goal].label}` : 'Editar objetivo'} onClose={onClose}>
      <label className="field">
        <span>Nombre</span>
        <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder={GOAL_INFO[p.goal].label} />
      </label>

      <label className="field">
        <span>Tipo</span>
        <select value={p.goal} onChange={(e) => setP({ ...p, goal: e.target.value as Goal })}>
          {(Object.keys(GOAL_INFO) as Goal[]).map((g) => (
            <option key={g} value={g}>
              {GOAL_INFO[g].icon} {GOAL_INFO[g].label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Señal sonora {p.goal === 'review' && <small>(clave del repaso: única para cada tema)</small>}</legend>
        <div className="chips">
          {p.goal !== 'review' && (
            <button className={`chip ${p.cue === null ? 'on' : ''}`} onClick={() => setP({ ...p, cue: null })}>
              Sin señal
            </button>
          )}
          {CUE_SOUNDS.map((c) => (
            <button
              key={c.id}
              className={`chip ${p.cue === c.id ? 'on' : ''}`}
              onClick={() => {
                setP({ ...p, cue: c.id as CueSoundId });
                void engine.playCue(c.id, volumeToGain(70));
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        {clash && <small className="warn">«{clash.name}» ya usa esta señal. Para repasar, cada tema necesita la suya.</small>}
      </fieldset>

      <fieldset className="field">
        <legend>Pistas de voz</legend>
        {tracks.length === 0 ? (
          <small className="muted">Aún no tienes pistas. Créalas en la pestaña «Pistas».</small>
        ) : (
          <div className="checklist">
            {tracks.map((t) => (
              <label key={t.id}>
                <input type="checkbox" checked={p.trackIds.includes(t.id)} onChange={() => toggleTrack(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        )}
        {p.goal === 'review' && (
          <small className="muted">
            Opcional. En repaso basta con la señal; si añades voz, que sean palabras clave de lo que estudiaste, nunca
            información nueva.
          </small>
        )}
      </fieldset>

      <label className="field">
        <span>{NOTES_LABEL[p.goal].label}</span>
        <textarea
          rows={p.goal === 'review' ? 8 : 3}
          value={p.notes}
          onChange={(e) => setP({ ...p, notes: e.target.value })}
          placeholder={NOTES_LABEL[p.goal].placeholder}
        />
      </label>

      <div className="actions">
        {!isNew && (
          <button className="ghost danger-text" onClick={remove}>
            Borrar
          </button>
        )}
        <span className="grow" />
        <button className="primary" onClick={save}>
          Guardar
        </button>
      </div>
    </Sheet>
  );
}
