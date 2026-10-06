import { useCallback, useState } from 'react';
import { useStore } from './lib/store';
import type { NightLog } from './lib/types';
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
  const { ready } = useStore();
  const [tab, setTab] = useState<Tab>('tonight');
  const [night, setNight] = useState<NightLog | null>(null);
  const [journalFor, setJournalFor] = useState<string | undefined>();
  const clearJournalFor = useCallback(() => setJournalFor(undefined), []);

  if (!ready) return <div className="splash">hiSleeper</div>;

  if (night) {
    return (
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
    );
  }

  return (
    <div className="app">
      <main>
        {tab === 'tonight' && <TonightScreen onStart={setNight} onGoTo={setTab} />}
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
