import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { NeonGameFactory } from './game/GamePresentationBridge.js';
import { PhaserArena } from './game/PhaserArena.js';
import { createArenaBridge, type GameStore } from './state/gameStore.js';
import { useGameStore } from './state/useGameStore.js';
import { LandingScreen } from './ui/LandingScreen.js';
import { LobbyScreen } from './ui/LobbyScreen.js';
import { ConnectionOverlay } from './ui/ConnectionOverlay.js';
import { ResultScreen } from './ui/ResultScreen.js';
import { ToastRegion } from './ui/ToastRegion.js';
import { TopBar } from './ui/TopBar.js';

type AppProps = Readonly<{
  store: GameStore;
  gameFactory?: NeonGameFactory;
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

export function App({ store, gameFactory }: AppProps) {
  const state = useGameStore(store);
  const viewportSupported = useSupportedViewport();
  const arenaBridge = useMemo(() => createArenaBridge(store), [store]);

  useEffect(() => {
    store.actions.connect();
    return () => store.dispose();
  }, [store]);

  if (!viewportSupported) {
    return (
      <main className="viewport-warning">
        <section className="viewport-warning__frame tech-frame" role="alert" aria-labelledby="viewport-warning-title">
          <h1 id="viewport-warning-title">Pencere çok küçük</h1>
          <p>Neon Knockout en az 900 × 600 masaüstü alanı gerektirir. Pencereyi büyüt.</p>
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
            onSetChassis={store.actions.setChassis}
            onToggleReady={store.actions.setReady}
            onStart={store.actions.startMatch}
            onCopyRoomCode={store.actions.copyRoomCode}
          />
        ) : null}

        {state.screen === 'MATCH' ? (
          <>
            <PhaserArena
              bridge={arenaBridge}
              localPlayerId={state.session?.playerId ?? ''}
              createGame={gameFactory}
            />
            {(state.connectionState !== 'connected' && state.connectionState !== 'idle') || state.reconnectRemainingMs !== null ? (
              <ConnectionOverlay
                connectionState={state.connectionState}
                remainingMs={state.reconnectRemainingMs}
                onRetry={store.actions.connect}
              />
            ) : null}
          </>
        ) : null}
        {state.screen === 'RESULT' ? (
          <ResultScreen
            state={state}
            onToggleReady={store.actions.setResultReady}
            onStart={store.actions.startMatch}
            onReturnToLobby={store.actions.returnToLobby}
          />
        ) : null}
      </main>

      <ToastRegion toasts={state.toasts} onDismiss={store.actions.dismissToast} />
    </div>
  );
}
