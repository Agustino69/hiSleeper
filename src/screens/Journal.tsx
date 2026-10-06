import { useEffect, useState } from 'react';
import { engine } from '../lib/audio/engine';
import { db, uid } from '../lib/db';
import { fmtClock, fmtDate, fmtMinutes } from '../lib/format';
import { useStore } from '../lib/store';
import type { JournalEntry, NightLog } from '../lib/types';
import { Empty, RecordButton, Sheet } from '../components/ui';

const HIT = ['No apareció', 'Algo relacionado', 'Claramente', '¡Sueño lúcido / total!'];

export function JournalScreen({ forNight, onConsumed }: { forNight?: string; onConsumed: () => void }) {
  const { journal, nights, programs } = useStore();
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!forNight) return;
    setEditing({
      id: uid(),
      createdAt: Date.now(),
      nightLogId: forNight,
      text: '',
      rememberedDream: true,
      incubationHit: 0,
      quality: 3,
    });
    onConsumed();
  }, [forNight, onConsumed]);

  const nightOf = (e: JournalEntry) => nights.find((n) => n.id === e.nightLogId);
  const dreamNight = (n?: NightLog) => !!n && programs.some((p) => n.programIds.includes(p.id) && p.goal === 'dream');

  const recall = journal.length ? journal.filter((j) => j.rememberedDream).length / journal.length : 0;
  const incubated = journal.filter((j) => dreamNight(nightOf(j)));
  const hits = incubated.filter((j) => j.incubationHit > 0).length;

  async function playVoice(e: JournalEntry) {
    audio?.pause();
    const blob = e.blobKey ? await db.blobs.get(e.blobKey) : undefined;
    if (!blob) return;
    const el = new Audio(URL.createObjectURL(blob));
    setAudio(el);
    void el.play();
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Diario</h1>
        <p className="muted">Anotar al despertar multiplica lo que recuerdas de tus sueños y te dice qué funciona.</p>
      </header>

      {journal.length > 0 && (
        <div className="stats">
          <div>
            <b>{journal.length}</b>
            <small>noches anotadas</small>
          </div>
          <div>
            <b>{Math.round(recall * 100)}%</b>
            <small>con sueño recordado</small>
          </div>
          <div>
            <b>{incubated.length ? `${hits}/${incubated.length}` : '—'}</b>
            <small>incubaciones logradas</small>
          </div>
        </div>
      )}

      <button
        className="primary wide"
        onClick={() =>
          setEditing({
            id: uid(),
            createdAt: Date.now(),
            nightLogId: nights[0]?.id,
            text: '',
            rememberedDream: true,
            incubationHit: 0,
            quality: 3,
          })
        }
      >
        ＋ Nueva entrada
      </button>

      {journal.length === 0 ? (
        <Empty>Aún no hay entradas. Mañana, al despertar, anota (o graba) lo primero que recuerdes.</Empty>
      ) : (
        <ul className="list">
          {journal.map((j) => {
            const n = nightOf(j);
            return (
              <li key={j.id} className="card" onClick={() => setEditing(j)}>
                <div className="row">
                  <b className="grow">{fmtDate(j.createdAt)}</b>
                  <span>{'★'.repeat(j.quality)}{'☆'.repeat(5 - j.quality)}</span>
                </div>
                {j.text && <p className="clamp">{j.text}</p>}
                <small className="muted">
                  {j.rememberedDream ? 'Sueño recordado' : 'Sin recuerdo'}
                  {dreamNight(n) ? ` · ${HIT[j.incubationHit]}` : ''}
                  {n ? ` · ${n.events.filter((e) => e.type === 'cue').length} reproducciones` : ''}
                </small>
                {j.blobKey && (
                  <button
                    className="small"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void playVoice(j);
                    }}
                  >
                    ▶ Escuchar relato
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EntryEditor({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const { journal, nights, programs, refresh } = useStore();
  const [e, setE] = useState(entry);
  const isNew = !journal.some((j) => j.id === e.id);
  const night = nights.find((n) => n.id === e.nightLogId);
  const nightPrograms = night ? programs.filter((p) => night.programIds.includes(p.id)) : [];
  const dream = nightPrograms.find((p) => p.goal === 'dream');

  useEffect(() => () => engine.stopCues(), []);

  async function save() {
    await db.journal.save(e);
    await refresh();
    onClose();
  }

  async function remove() {
    if (!confirm('¿Borrar esta entrada?')) return;
    await db.journal.remove(e);
    await refresh();
    onClose();
  }

  return (
    <Sheet title={isNew ? '¿Qué soñaste?' : fmtDate(e.createdAt)} onClose={onClose}>
      {night && <NightSummary night={night} />}
      <label className="field check">
        <input type="checkbox" checked={e.rememberedDream} onChange={(x) => setE({ ...e, rememberedDream: x.target.checked })} />
        Recuerdo algo de lo que soñé
      </label>
      <label className="field">
        <span>Relato (lugares, personas, emociones… aunque sean fragmentos)</span>
        <textarea rows={6} value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} autoFocus={isNew} />
      </label>
      <div className="row">
        <RecordButton
          label={e.blobKey ? 'Regrabar relato de voz' : 'Grabar relato de voz'}
          onDone={async (blob) => setE({ ...e, blobKey: await db.blobs.add(blob) })}
        />
        {e.blobKey && <small className="ok">✓ Audio guardado</small>}
      </div>
      {dream && (
        <fieldset className="field">
          <legend>¿Apareció «{dream.name}» en tus sueños?</legend>
          <div className="chips">
            {HIT.map((h, i) => (
              <button key={h} className={`chip ${e.incubationHit === i ? 'on' : ''}`} onClick={() => setE({ ...e, incubationHit: i })}>
                {h}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="field">
        <legend>¿Cómo dormiste?</legend>
        <div className="stars">
          {[1, 2, 3, 4, 5].map((q) => (
            <button key={q} className="ghost" onClick={() => setE({ ...e, quality: q })} aria-label={`${q} estrellas`}>
              {q <= e.quality ? '★' : '☆'}
            </button>
          ))}
        </div>
        <small className="muted">Si notas que duermes peor, baja el volumen dormido o activa el detector de movimiento.</small>
      </fieldset>
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

function NightSummary({ night }: { night: NightLog }) {
  const end = night.endedAt ?? night.startedAt + night.totalMin * 60000;
  const cues = night.events.filter((e) => e.type === 'cue').length;
  const moves = night.events.filter((e) => e.type === 'motion').length;
  return (
    <p className="muted small">
      Noche {fmtClock(new Date(night.startedAt))} – {fmtClock(new Date(end))} ({fmtMinutes((end - night.startedAt) / 60000)}) ·{' '}
      {cues} reproducciones · {moves} movimientos detectados
    </p>
  );
}
