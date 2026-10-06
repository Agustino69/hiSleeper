import { useEffect, useState } from 'react';
import { db, uid } from '../lib/db';
import { CUE_SOUNDS, NOISE_TYPES } from '../lib/audio/synth';
import { GOAL_INFO } from '../lib/format';
import { useStore } from '../lib/store';
import { getOpenAIKey } from '../lib/tts/openai';
import { specFromStyle, styleById, type Template } from '../lib/tts/presets';
import { encodeWav, renderVoice } from '../lib/tts/render';
import { usePiperVoice } from '../lib/tts/usePiper';
import type { Track } from '../lib/types';
import { Sheet } from './ui';

type Choice = 'piper' | 'openai' | 'system';

/** Crea un objetivo completo desde una plantilla: genera las voces, la señal y el fondo. */
export function TemplateSheet({ template, onClose }: { template: Template; onClose: () => void }) {
  const { settings, saveSettings, refresh } = useStore();
  const style = styleById(template.styleId)!;
  const voiceId = template.piperVoice ?? style.piperVoice;
  const piper = usePiperVoice(voiceId);
  const [hasKey, setHasKey] = useState(false);
  const [choice, setChoice] = useState<Choice>('piper');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void getOpenAIKey().then((k) => setHasKey(!!k));
  }, []);

  async function create() {
    setError('');
    try {
      const trackIds: string[] = [];
      for (let i = 0; i < template.tracks.length; i++) {
        const t = template.tracks[i];
        let track: Track;
        if (choice === 'system') {
          track = { id: uid(), name: t.name, kind: 'tts', text: t.text, ttsRate: style.params.speed * 0.95, createdAt: Date.now() };
        } else {
          const spec = specFromStyle(style, choice, choice === 'piper' ? voiceId : undefined);
          const buf = await renderVoice(t.text, spec, (d, n) =>
            setBusy(`Voz ${i + 1} de ${template.tracks.length} · frase ${Math.min(d + 1, n)} de ${n}…`),
          );
          track = {
            id: uid(),
            name: t.name,
            kind: 'voice',
            text: t.text,
            synth: spec,
            blobKey: await db.blobs.add(encodeWav(buf)),
            mime: 'audio/wav',
            durationSec: buf.duration,
            createdAt: Date.now(),
          };
        }
        await db.tracks.save(track);
        trackIds.push(track.id);
      }
      await db.programs.save({
        id: uid(),
        name: `${template.icon} ${template.name}`,
        goal: template.goal,
        cue: template.cue,
        trackIds,
        notes: template.notes,
        enabled: true,
        createdAt: Date.now(),
      });
      if (template.noise && template.noise !== settings.noise) await saveSettings({ ...settings, noise: template.noise });
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const blocked = !!busy || (choice === 'piper' && !piper.ready);

  return (
    <Sheet title={`${template.icon} ${template.name}`} onClose={onClose}>
      <p>{template.blurb}</p>
      <ul className="plain small muted">
        <li>
          {GOAL_INFO[template.goal].icon} {GOAL_INFO[template.goal].label}
        </li>
        <li>
          Voz: {style.icon} {style.label}
        </li>
        {template.cue && <li>Señal: {CUE_SOUNDS.find((c) => c.id === template.cue)?.label}</li>}
        {template.noise && <li>Fondo: {NOISE_TYPES.find((n) => n.id === template.noise)?.label}</li>}
      </ul>
      <details>
        <summary>Ver los guiones</summary>
        {template.tracks.map((t) => (
          <div key={t.name} className="script">
            <b>{t.name}</b>
            <p>{t.text}</p>
          </div>
        ))}
        <small className="muted">Podrás editarlos después en «Pistas».</small>
      </details>

      <fieldset className="field">
        <legend>Generar la voz con</legend>
        <div className="segmented">
          <button className={choice === 'piper' ? 'on' : ''} onClick={() => setChoice('piper')}>
            Neural
            <small>en el teléfono</small>
          </button>
          <button className={choice === 'openai' ? 'on' : ''} onClick={() => setChoice('openai')} disabled={!hasKey} title={hasKey ? '' : 'Añade tu clave en el Estudio de voz'}>
            Nube
            <small>{hasKey ? 'más expresiva' : 'requiere clave'}</small>
          </button>
          <button className={choice === 'system' ? 'on' : ''} onClick={() => setChoice('system')}>
            Básica
            <small>sin descarga</small>
          </button>
        </div>
        {choice === 'piper' &&
          piper.ready === false &&
          (piper.progress != null ? (
            <div className="download">
              <progress value={piper.progress} max={1} />
              <small>Descargando… {Math.round(piper.progress * 100)}%</small>
            </div>
          ) : (
            <button onClick={piper.download}>⬇ Descargar voz ({piper.sizeMb} MB, una sola vez)</button>
          ))}
        {choice === 'piper' && piper.ready && <small className="ok">✓ Voz lista</small>}
        {piper.error && <small className="error">{piper.error}</small>}
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <span className="grow muted small">{busy}</span>
        <button className="primary" onClick={create} disabled={blocked}>
          Crear objetivo
        </button>
      </div>
    </Sheet>
  );
}
