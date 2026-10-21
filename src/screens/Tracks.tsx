import { useRef, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { engine } from '../lib/audio/engine';
import { db, uid } from '../lib/db';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Track } from '../lib/types';
import { Empty, RecordButton, Sheet, type SheetHandle } from '../components/ui';
import { toast } from '../lib/toast';
import { haptic } from '../lib/haptics';
import { VoiceStudio } from '../components/VoiceStudio';
import { styleById } from '../lib/tts/presets';

const KIND_LABEL: Record<Track['kind'], string> = { recording: 'Tu voz', file: 'Archivo', tts: 'Voz básica', voice: 'Voz IA' };

export function TracksScreen() {
  const { tracks, programs, refresh } = useStore();
  const [adding, setAdding] = useState<null | 'voice' | 'studio'>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [renaming, setRenaming] = useState<Track | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  async function play(t: Track) {
    if (playing) {
      engine.stopCues();
      setPlaying(null);
      return;
    }
    setPlaying(t.id);
    try {
      await engine.playTrack(t, volumeToGain(75));
    } finally {
      setPlaying(null);
    }
  }

  async function importFile(file: File) {
    const blobKey = await db.blobs.add(file);
    await db.tracks.save({
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ''),
      kind: 'file',
      blobKey,
      mime: file.type,
      createdAt: Date.now(),
    });
    await refresh();
  }

  /** Se borra al momento y se ofrece deshacer (en lugar de pedir confirmación). */
  async function remove(t: Track) {
    const users = programs.filter((p) => p.trackIds.includes(t.id));
    const blob = t.blobKey ? await db.blobs.get(t.blobKey) : undefined;
    for (const p of users) await db.programs.save({ ...p, trackIds: p.trackIds.filter((id) => id !== t.id) });
    engine.forgetTrack(t.id);
    await db.tracks.remove(t);
    await refresh();
    toast(users.length ? `«${t.name}» borrada (también de ${users.map((p) => p.name).join(', ')})` : `«${t.name}» borrada`, {
      action: {
        label: 'Deshacer',
        run: async () => {
          if (t.blobKey && blob) await db.blobs.put(t.blobKey, blob);
          await db.tracks.save(t);
          for (const p of users) await db.programs.save(p);
          await refresh();
        },
      },
    });
  }

  return (
    <div className="screen">
      <ScreenHeader title="Pistas">
        <p className="muted">Lo que sonará de noche: voces IA con estilo, tu propia voz o audios que ya tengas.</p>
      </ScreenHeader>

      <div className="actions">
        <button className="primary" onClick={() => setAdding('studio')}>
          ✨ Voz IA
        </button>
        <button onClick={() => setAdding('voice')}>🎙️ Grabar mi voz</button>
        <label className="button">
          📁 Importar audio
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {tracks.length === 0 ? (
        <Empty>
          Aún no hay pistas. Crea una con «Voz IA» (prueba el estilo 🏴‍☠️ Capitán pirata), graba tu voz o usa una plantilla en «Objetivos».
        </Empty>
      ) : (
        <ul className="list">
          {tracks.map((t) => (
            <li key={t.id} className="card row">
              <button className="icon round" onClick={() => play(t)} aria-label={playing === t.id ? 'Detener' : 'Escuchar'}>
                {playing === t.id ? '■' : '▶'}
              </button>
              <div className="grow">
                <b>{t.name}</b>
                <small className="muted">
                  {t.synth ? `${styleById(t.synth.styleId)?.icon ?? '✨'} ` : ''}
                  {KIND_LABEL[t.kind]}
                  {t.durationSec ? ` · ${Math.round(t.durationSec)} s` : ''}
                  {t.kind === 'tts' && t.text ? ` · «${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''}»` : ''}
                </small>
              </div>
              <button
                className="ghost icon"
                onClick={() => (t.kind === 'voice' || t.kind === 'tts' ? setEditing(t) : setRenaming(t))}
                aria-label={t.kind === 'voice' || t.kind === 'tts' ? 'Editar voz' : 'Renombrar'}
              >
                ✎
              </button>
              <button className="ghost icon" onClick={() => remove(t)} aria-label="Borrar">
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding === 'voice' && <VoiceSheet onClose={() => setAdding(null)} />}
      {adding === 'studio' && <VoiceStudio onClose={() => setAdding(null)} />}
      {editing && <VoiceStudio track={editing} onClose={() => setEditing(null)} />}
      {renaming && <RenameSheet track={renaming} onClose={() => setRenaming(null)} />}
    </div>
  );
}

function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState('');
  const sheet = useRef<SheetHandle>(null);

  async function save(blob: Blob, sec: number) {
    const blobKey = await db.blobs.add(blob);
    await db.tracks.save({
      id: uid(),
      name: name.trim() || `Grabación ${new Date().toLocaleString()}`,
      kind: 'recording',
      blobKey,
      mime: blob.type,
      durationSec: sec,
      createdAt: Date.now(),
    });
    await refresh();
    haptic('commit');
    toast('Grabación guardada');
    sheet.current?.dismiss();
  }

  return (
    <Sheet title="Grabar mi voz" onClose={onClose} ref={sheet}>
      <label className="field">
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Ciclo de Krebs" />
      </label>
      <ul className="tips">
        <li>Habla despacio, en voz baja y tranquila, como si fuera de noche.</li>
        <li>Frases cortas (5–20 s). Varias pistas cortas funcionan mejor que una larga.</li>
        <li>Para mantras usa presente y primera persona: «Estoy tranquilo y seguro».</li>
        <li>Para soñar: describe la escena con detalles sensoriales: «Estoy en la playa, siento la arena tibia…».</li>
      </ul>
      <RecordButton onDone={save} />
    </Sheet>
  );
}

function RenameSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState(track.name);
  const sheet = useRef<SheetHandle>(null);

  async function save() {
    if (!name.trim()) return;
    await db.tracks.save({ ...track, name: name.trim() });
    await refresh();
    sheet.current?.dismiss();
  }

  return (
    <Sheet title="Renombrar pista" onClose={onClose} ref={sheet}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Nombre" />
        <button className="primary" disabled={!name.trim()}>
          Guardar
        </button>
      </form>
    </Sheet>
  );
}
