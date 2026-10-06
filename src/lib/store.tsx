import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { db, DEFAULT_SETTINGS } from './db';
import type { JournalEntry, NightLog, NightSettings, Program, Track } from './types';

interface Data {
  ready: boolean;
  tracks: Track[];
  programs: Program[];
  settings: NightSettings;
  journal: JournalEntry[];
  nights: NightLog[];
}

interface Store extends Data {
  refresh: () => Promise<void>;
  saveSettings: (s: NightSettings) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>({
    ready: false,
    tracks: [],
    programs: [],
    settings: DEFAULT_SETTINGS,
    journal: [],
    nights: [],
  });

  const refresh = useCallback(async () => {
    const [tracks, programs, settings, journal, nights] = await Promise.all([
      db.tracks.list(),
      db.programs.list(),
      db.settings.get(),
      db.journal.list(),
      db.nights.list(),
    ]);
    setData({ ready: true, tracks, programs, settings, journal, nights });
  }, []);

  const saveSettings = useCallback(async (s: NightSettings) => {
    setData((d) => ({ ...d, settings: s }));
    await db.settings.save(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ ...data, refresh, saveSettings }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider ausente');
  return s;
}
