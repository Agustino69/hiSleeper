import { useEffect, useState } from 'react';
import { engine, getVoices, defaultVoice } from '../lib/audio/engine';
import { db, uid } from '../lib/db';
import { volumeToGain } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Track } from '../lib/types';
import { Empty, RecordButton, Sheet } from '../components/ui';

const KIND_LABEL: Record<Track['kind'], string> = { recording: 'Tu voz', file: 'Archivo', tts: 'Voz sintética' };

export function TracksScreen() {
  const { tracks, programs, refresh } = useStore();
  const [adding, setAdding] = useState<null | 'voice' | 'tts'>(null);
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

  async function rename(t: Track) {
    const name = prompt('Nombre de la pista', t.name)?.trim();
    if (!name) return;
    await db.tracks.save({ ...t, name });
    await refresh();
  }

  async function remove(t: Track) {
    const users = programs.filter((p) => p.trackIds.includes(t.id));
    const msg = users.length
      ? `«${t.name}» se usa en ${users.map((p) => p.name).join(', ')}. ¿Borrarla igualmente?`
      : `¿Borrar «${t.name}»?`;
    if (!confirm(msg)) return;
    for (const p of users) await db.programs.save({ ...p, trackIds: p.trackIds.filter((id) => id !== t.id) });
    engine.forgetTrack(t.id);
    await db.tracks.remove(t);
    await refresh();
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Pistas</h1>
        <p className="muted">Lo que sonará de noche: tu propia voz, audios que ya tengas o texto leído por el teléfono.</p>
      </header>

      <div className="actions">
        <button className="primary" onClick={() => setAdding('voice')}>
          🎙️ Grabar mi voz
        </button>
        <button onClick={() => setAdding('tts')}>💬 Texto a voz</button>
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
          Aún no hay pistas. Graba frases cortas: un concepto que repasar, tu mantra o la escena que quieres soñar.
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
                  {KIND_LABEL[t.kind]}
                  {t.durationSec ? ` · ${Math.round(t.durationSec)} s` : ''}
                  {t.kind === 'tts' && t.text ? ` · «${t.text.slice(0, 40)}${t.text.length > 40 ? '…' : ''}»` : ''}
                </small>
              </div>
              <button className="ghost icon" onClick={() => rename(t)} aria-label="Renombrar">
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
      {adding === 'tts' && <TtsSheet onClose={() => setAdding(null)} />}
    </div>
  );
}

function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState('');

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
    onClose();
  }

  return (
    <Sheet title="Grabar mi voz" onClose={onClose}>
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

function TtsSheet({ onClose }: { onClose: () => void }) {
  const { refresh } = useStore();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [rate, setRate] = useState(0.85);
  const [voices, setVoices] = useState(getVoices());
  const [voice, setVoice] = useState(defaultVoice()?.voiceURI ?? '');

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => {
      setVoices(getVoices());
      setVoice((v) => v || defaultVoice()?.voiceURI || '');
    };
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const draft = (): Track => ({
    id: uid(),
    name: name.trim() || text.trim().slice(0, 30),
    kind: 'tts',
    text: text.trim(),
    ttsRate: rate,
    ttsVoice: voice,
    createdAt: Date.now(),
  });

  async function save() {
    if (!text.trim()) return;
    await db.tracks.save(draft());
    await refresh();
    onClose();
  }

  const lang = navigator.language.slice(0, 2);
  const sorted = [...voices].sort((a, b) => Number(b.lang.startsWith(lang)) - Number(a.lang.startsWith(lang)));

  return (
    <Sheet title="Texto a voz" onClose={onClose}>
      {typeof speechSynthesis === 'undefined' && <p className="error">Este navegador no tiene síntesis de voz.</p>}
      <label className="field">
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" />
      </label>
      <label className="field">
        <span>Texto</span>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Frase corta y clara" />
      </label>
      <label className="field">
        <span>Voz</span>
        <select value={voice} onChange={(e) => setVoice(e.target.value)}>
          {sorted.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-row">
          <span>Velocidad</span>
          <b>{rate.toFixed(2)}×</b>
        </span>
        <input type="range" min={0.5} max={1.2} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
      </label>
      <small className="muted">
        Nota: la voz sintética no pasa por el filtro ni por los fundidos, y algunos móviles ignoran su volumen. Para
        la noche, tu voz grabada es más fiable.
      </small>
      <div className="actions">
        <button onClick={() => void engine.playTrack(draft(), volumeToGain(75))} disabled={!text.trim()}>
          ▶ Probar
        </button>
        <button className="primary" onClick={save} disabled={!text.trim()}>
          Guardar
        </button>
      </div>
    </Sheet>
  );
}
