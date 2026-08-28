import { useEffect } from 'react';
import type { GameStore } from './state/gameStore.js';
import { useGameStore } from './state/useGameStore.js';
import { LandingScreen } from './ui/LandingScreen.js';
import { LobbyScreen } from './ui/LobbyScreen.js';
import { ToastRegion } from './ui/ToastRegion.js';
import { TopBar } from './ui/TopBar.js';

type AppProps = Readonly<{
  store: GameStore;
}>;

function MatchPlaceholder() {
  return (
    <section className="screen future-screen" aria-label="ÇEKİRDEK">
      <div className="tech-frame future-screen__frame">
        <strong>ÇEKİRDEK</strong>
        <span>WASD: Hareket</span>
        <span>SPACE: Hamle</span>
      </div>
    </section>
  );
}

function ResultPlaceholder() {
  return (
    <section className="screen future-screen" aria-label="Bekliyor">
      <div className="tech-frame future-screen__frame">
        <strong>Bekliyor</strong>
      </div>
    </section>
  );
}

export function App({ store }: AppProps) {
  const state = useGameStore(store);

  useEffect(() => {
    store.actions.connect();
    return () => store.dispose();
  }, [store]);

  return (
    <div className="app-shell">
      <TopBar state={state} onToggleSound={store.actions.toggleSound} />

      <main className="app-main">
        {state.screen === 'LANDING' ? (
          <LandingScreen state={state} onCreateRoom={store.actions.createRoom} onJoinRoom={store.actions.joinRoom} />
        ) : null}

        {state.screen === 'LOBBY' ? (
          <LobbyScreen
            state={state}
            onSetTeam={store.actions.setTeam}
            onToggleReady={store.actions.setReady}
            onStart={store.actions.startMatch}
            onCopyRoomCode={store.actions.copyRoomCode}
          />
        ) : null}

        {state.screen === 'MATCH' ? <MatchPlaceholder /> : null}
        {state.screen === 'RESULT' ? <ResultPlaceholder /> : null}
      </main>

      <ToastRegion toasts={state.toasts} onDismiss={store.actions.dismissToast} />
    </div>
  );
}
