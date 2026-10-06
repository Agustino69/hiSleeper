import type { JournalEntry, NightLog, NightSettings, Program, Track } from './types';

/** Almacenamiento local: todo queda en el dispositivo (IndexedDB). */

const DB_NAME = 'hisleeper';
const DB_VERSION = 2;
type StoreName = 'tracks' | 'programs' | 'nights' | 'journal' | 'blobs' | 'meta' | 'assets';
const STORES: StoreName[] = ['tracks', 'programs', 'nights', 'journal', 'blobs', 'meta', 'assets'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

async function get<T>(name: StoreName, key: string): Promise<T | undefined> {
  return wrap((await store(name, 'readonly')).get(key)) as Promise<T | undefined>;
}

async function put(name: StoreName, key: string, value: unknown): Promise<void> {
  await wrap((await store(name, 'readwrite')).put(value, key));
}

async function del(name: StoreName, key: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(key));
}

async function all<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name, 'readonly')).getAll()) as Promise<T[]>;
}

export function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const db = {
  tracks: {
    list: () => all<Track>('tracks').then((t) => t.sort((a, b) => b.createdAt - a.createdAt)),
    save: (t: Track) => put('tracks', t.id, t),
    async remove(t: Track) {
      if (t.blobKey) await del('blobs', t.blobKey);
      await del('tracks', t.id);
    },
  },
  programs: {
    list: () => all<Program>('programs').then((p) => p.sort((a, b) => a.createdAt - b.createdAt)),
    save: (p: Program) => put('programs', p.id, p),
    remove: (id: string) => del('programs', id),
  },
  nights: {
    list: () => all<NightLog>('nights').then((n) => n.sort((a, b) => b.startedAt - a.startedAt)),
    get: (id: string) => get<NightLog>('nights', id),
    save: (n: NightLog) => put('nights', n.id, n),
  },
  journal: {
    list: () => all<JournalEntry>('journal').then((j) => j.sort((a, b) => b.createdAt - a.createdAt)),
    save: (j: JournalEntry) => put('journal', j.id, j),
    async remove(j: JournalEntry) {
      if (j.blobKey) await del('blobs', j.blobKey);
      await del('journal', j.id);
    },
  },
  blobs: {
    get: (key: string) => get<Blob>('blobs', key),
    remove: (key: string) => del('blobs', key),
    async add(blob: Blob): Promise<string> {
      const key = uid();
      await put('blobs', key, blob);
      return key;
    },
  },
  settings: {
    async get(): Promise<NightSettings> {
      return { ...DEFAULT_SETTINGS, ...((await get<Partial<NightSettings>>('meta', 'settings')) ?? {}) };
    },
    save: (s: NightSettings) => put('meta', 'settings', s),
  },
  /** Recursos descargados (modelos de voz, motores wasm), por nombre. */
  assets: {
    get: (key: string) => get<Blob>('assets', key),
    put: (key: string, blob: Blob) => put('assets', key, blob),
    remove: (key: string) => del('assets', key),
    async keys(): Promise<string[]> {
      return wrap((await store('assets', 'readonly')).getAllKeys()) as Promise<string[]>;
    },
  },
  meta: {
    get: <T>(key: string) => get<T>('meta', key),
    set: (key: string, value: unknown) => put('meta', key, value),
    remove: (key: string) => del('meta', key),
  },
  activeNight: {
    get: () => get<string>('meta', 'activeNight'),
    set: (id: string | null) => (id ? put('meta', 'activeNight', id) : del('meta', 'activeNight')),
  },
};

export const DEFAULT_SETTINGS: NightSettings = {
  latencyMin: 20,
  cycleMin: 90,
  wakeTime: '07:00',
  cueVolume: 35,
  onsetVolume: 55,
  noise: 'pink',
  noiseVolume: 45,
  motionSensitivity: 3,
  motionPauseMin: 5,
  gentleAlarm: true,
  deepCycles: 3,
};
