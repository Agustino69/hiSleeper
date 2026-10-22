import { useEffect, useState } from 'react';
import { GEMINI_KEY_URL, getGeminiKey, setGeminiKey } from '../lib/tts/gemini';

/** Estado de la clave gratuita de Google AI Studio (compartida por la voz y el guionista). */
export function useGeminiKey() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    void getGeminiKey().then((k) => setHasKey(!!k));
  }, []);
  return {
    hasKey,
    save: async (k: string) => {
      await setGeminiKey(k);
      setHasKey(!!k.trim());
    },
  };
}

export function GeminiKeyField({ hasKey, onSave }: { hasKey: boolean | null; onSave: (k: string) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  if (hasKey === null) return null;
  if (hasKey) {
    return (
      <small className="ok">
        ✓ Clave de Google guardada en este dispositivo ·{' '}
        <button className="link" type="button" onClick={() => void onSave('')}>
          quitar
        </button>
      </small>
    );
  }
  return (
    <>
      <small className="muted">
        Gratis con tu cuenta de Google: crea una clave en{' '}
        <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer">
          Google AI Studio
        </a>{' '}
        (sin tarjeta) y pégala aquí. Sirve para la voz actuada y para escribir con IA. El plan gratuito tiene límites de
        uso por minuto y por día.
      </small>
      <div className="row">
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Clave de Google AI Studio" autoComplete="off" />
        <button
          className="primary"
          type="button"
          disabled={!draft.trim()}
          onClick={async () => {
            await onSave(draft);
            setDraft('');
          }}
        >
          Guardar
        </button>
      </div>
    </>
  );
}
