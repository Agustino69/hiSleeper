import { db } from '../db';

/**
 * Descarga de recursos grandes (modelos de voz, motores wasm) con progreso.
 * Se guardan en IndexedDB: tras la primera descarga todo funciona sin conexión.
 */

export type Progress = (loaded: number, total: number) => void;

const inflight = new Map<string, Promise<Blob>>();

export async function hasAsset(key: string): Promise<boolean> {
  return (await db.assets.keys()).includes(key);
}

export function fetchAsset(key: string, url: string, onProgress?: Progress): Promise<Blob> {
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    const cached = await db.assets.get(key);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}): ${url}`);
    const total = Number(res.headers.get('Content-Length') ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('Content-Type') ?? 'application/octet-stream' });
    await db.assets.put(key, blob);
    return blob;
  })();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key)).catch(() => undefined);
  return p;
}

export async function removeAsset(key: string) {
  await db.assets.remove(key);
}
