import { useEffect, useSyncExternalStore } from 'react';
import { GameCanvas } from './game/GameCanvas.js';
import type { GameStore } from './state/gameStore.js';
import { useGameStore } from './state/useGameStore.js';
import { LandingScreen } from './ui/LandingScreen.js';
import { LobbyScreen } from './ui/LobbyScreen.js';
import { ToastRegion } from './ui/ToastRegion.js';
import { TopBar } from './ui/TopBar.js';

type AppProps = Readonly<{
  store: GameStore;
}>;

const MIN_VIEWPORT_WIDTH = 900;
const MIN_VIEWPORT_HEIGHT = 600;

function viewportIsSupported(): boolean {
  return window.innerWidth >= MIN_VIEWPORT_WIDTH && window.innerHeight >= MIN_VIEWPORT_HEIGHT;
}

function subscribeToViewport(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function useSupportedViewport(): boolean {
  return useSyncExternalStore(subscribeToViewport, viewportIsSupported, () => true);
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
  const viewportSupported = useSupportedViewport();

  useEffect(() => {
    store.actions.connect();
    return () => store.dispose();
  }, [store]);

  if (!viewportSupported) {
    return (
      <main className="viewport-warning">
        <section className="viewport-warning__frame tech-frame" role="alert" aria-labelledby="viewport-warning-title">
          <h1 id="viewport-warning-title">Pencere çok küçük</h1>
          <p>Neon Relay en az 900 × 600 masaüstü alanı gerektirir. Pencereyi büyüt.</p>
        </section>
      </main>
    );
  }

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

        {state.screen === 'MATCH' ? <GameCanvas store={store} localPlayerId={state.session?.playerId ?? ''} /> : null}
        {state.screen === 'RESULT' ? <ResultPlaceholder /> : null}
      </main>

      <ToastRegion toasts={state.toasts} onDismiss={store.actions.dismissToast} />
    </div>
  );
}
