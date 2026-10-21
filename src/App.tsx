import { useCallback, useEffect, useState } from 'react';
import { Focus, focusSupported, syncFocus, type BlockedEvent } from './lib/focusBridge';
import { useStore } from './lib/store';
import type { NightLog } from './lib/types';
import { BlockedScreen } from './screens/BlockedScreen';
import { GuideScreen } from './screens/Guide';
import { JournalScreen } from './screens/Journal';
import { NightMode } from './screens/NightMode';
import { ProgramsScreen } from './screens/Programs';
import { TonightScreen } from './screens/Tonight';
import { TracksScreen } from './screens/Tracks';

type Tab = 'tonight' | 'programs' | 'tracks' | 'journal' | 'guide';

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'tonight', icon: '🌙', label: 'Noche' },
  { id: 'programs', icon: '🎯', label: 'Objetivos' },
  { id: 'tracks', icon: '🎙️', label: 'Pistas' },
  { id: 'journal', icon: '📓', label: 'Diario' },
  { id: 'guide', icon: '💡', label: 'Guía' },
];

export function App() {
  const { ready, nights } = useStore();
  const [tab, setTab] = useState<Tab>('tonight');
  const [night, setNight] = useState<NightLog | null>(null);
  const [journalFor, setJournalFor] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<BlockedEvent | null>(null);
  const clearJournalFor = useCallback(() => setJournalFor(undefined), []);

  // Bloqueo de apps: renueva las ventanas al abrir la app y escucha los bloqueos.
  useEffect(() => {
    void syncFocus();
    if (!focusSupported) return;
    const sub = Focus.addListener('blocked', setBlocked);
    return () => void sub.then((h) => h.remove());
  }, []);

  if (!ready) return <div className="splash">hiSleeper</div>;

  const overlay = blocked && (
    <BlockedScreen
      event={blocked}
      onClose={() => setBlocked(null)}
      onStartNight={() => {
        setBlocked(null);
        if (!night) setTab('tonight');
      }}
      onJournal={() => {
        setBlocked(null);
        setJournalFor(nights[0]?.id ?? 'sin-noche');
        setTab('journal');
      }}
    />
  );

  if (night) {
    return (
      <>
      {overlay}
      <NightMode
        log={night}
        onExit={(id) => {
          setNight(null);
          if (id) {
            setJournalFor(id);
            setTab('journal');
          }
        }}
      />
      </>
    );
  }

  return (
    <div className="app">
      {overlay}
      <main>
        {tab === 'tonight' && (
          <TonightScreen onStart={setNight} onGoTo={setTab} onMorningUnlock={() => setBlocked({ kind: 'morning', at: Date.now() })} />
        )}
        {tab === 'programs' && <ProgramsScreen />}
        {tab === 'tracks' && <TracksScreen />}
        {tab === 'journal' && <JournalScreen forNight={journalFor} onConsumed={clearJournalFor} />}
        {tab === 'guide' && <GuideScreen />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span>
            <small>{t.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
