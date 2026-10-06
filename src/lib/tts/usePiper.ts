import { useCallback, useEffect, useState } from 'react';
import { downloadVoice, isEngineReady, isVoiceReady, piperVoice, ENGINE_SIZE_MB } from './piper';

/** Estado de descarga de una voz Piper para la interfaz. */
export function usePiperVoice(id: string) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [sizeMb, setSizeMb] = useState(0);

  useEffect(() => {
    let alive = true;
    setReady(null);
    void Promise.all([isVoiceReady(id), isEngineReady()]).then(([v, e]) => {
      if (!alive) return;
      setReady(v && e);
      setSizeMb((v ? 0 : piperVoice(id).sizeMb) + (e ? 0 : ENGINE_SIZE_MB));
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const download = useCallback(async () => {
    setError('');
    setProgress(0);
    try {
      await downloadVoice(id, (l, t) => setProgress(t ? l / t : 0));
      setReady(true);
    } catch (e) {
      setError(`No se pudo descargar: ${(e as Error).message}. ¿Hay conexión?`);
    } finally {
      setProgress(null);
    }
  }, [id]);

  return { ready, progress, error, sizeMb, download };
}
