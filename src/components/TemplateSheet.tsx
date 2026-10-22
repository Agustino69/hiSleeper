import { useEffect, useRef, useState } from 'react';
import { db, uid } from '../lib/db';
import { CUE_SOUNDS, NOISE_TYPES } from '../lib/audio/synth';
import { GOAL_INFO } from '../lib/format';
import { useStore } from '../lib/store';
import { getGeminiKey } from '../lib/tts/gemini';
import { specFromStyle, styleById, type Template } from '../lib/tts/presets';
import { encodeWav, renderVoice } from '../lib/tts/render';
import { useSupertonic } from '../lib/tts/usePiper';
import type { Track } from '../lib/types';
import { Sheet, type SheetHandle } from './ui';
import { Segmented } from './Segmented';
import { toast } from '../lib/toast';
import { haptic } from '../lib/haptics';

type Choice = 'supertonic' | 'gemini' | 'system';

/** Crea un objetivo completo desde una plantilla: genera las voces, la señal y el fondo. */
export function TemplateSheet({ template, onClose }: { template: Template; onClose: () => void }) {
  const { settings, saveSettings, refresh } = useStore();
  const style = styleById(template.styleId)!;
  const device = useSupertonic();
  const [hasKey, setHasKey] = useState(false);
  const [choice, setChoice] = useState<Choice>('supertonic');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sheet = useRef<SheetHandle>(null);

  useEffect(() => {
    void getGeminiKey().then((k) => setHasKey(!!k));
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
          const spec = { ...specFromStyle(style, choice), lang: template.lang };
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
      haptic('success');
      toast(`${template.icon} «${template.name}» listo para esta noche`);
      sheet.current?.dismiss();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const blocked = !!busy || (choice === 'supertonic' && !device.ready);

  return (
    <Sheet title={`${template.icon} ${template.name}`} onClose={onClose} ref={sheet}>
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
        <Segmented
          label="Generar la voz con"
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'supertonic', label: 'Natural', hint: 'en el teléfono' },
            {
              value: 'gemini',
              label: 'Actuada',
              hint: hasKey ? 'nube · gratis' : 'requiere clave gratis',
              disabled: !hasKey,
              title: hasKey ? undefined : 'Añade tu clave en el Estudio de voz',
            },
            { value: 'system', label: 'Básica', hint: 'sin descarga' },
          ]}
        />
        {choice === 'supertonic' &&
          device.ready === false &&
          (device.progress != null ? (
            <div className="download">
              <progress value={device.progress} max={1} />
              <small>Descargando… {Math.round(device.progress * 100)}%</small>
            </div>
          ) : (
            <button onClick={device.download}>⬇ Descargar voces naturales ({device.sizeMb} MB, una sola vez)</button>
          ))}
        {choice === 'supertonic' && device.ready && <small className="ok">✓ Voces listas</small>}
        {device.error && <small className="error">{device.error}</small>}
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
