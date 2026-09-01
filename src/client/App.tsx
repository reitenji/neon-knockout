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

function viewportNeedsRotation(): boolean {
  const touchCapable = (window.matchMedia?.('(pointer: coarse)').matches ?? false) || navigator.maxTouchPoints > 0;
  return touchCapable && window.innerHeight > window.innerWidth;
}

function subscribeToViewport(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  window.addEventListener('orientationchange', listener);
  return () => {
    window.removeEventListener('resize', listener);
    window.removeEventListener('orientationchange', listener);
  };
}

function usePortraitViewport(): boolean {
  return useSyncExternalStore(subscribeToViewport, viewportNeedsRotation, () => false);
}

export function App({ store, gameFactory }: AppProps) {
  const state = useGameStore(store);
  const portraitViewport = usePortraitViewport();
  const arenaBridge = useMemo(() => createArenaBridge(store), [store]);

  useEffect(() => {
    store.actions.connect();
    return () => store.dispose();
  }, [store]);

  return (
    <div className={`app-shell${state.screen === 'MATCH' ? ' app-shell--match' : ''}`}>
      <TopBar state={state} onToggleSound={store.actions.toggleSound} onLeaveRoom={store.actions.leaveRoom} />

      <main className="app-main">
        {state.screen === 'LANDING' ? (
          <LandingScreen state={state} onCreateRoom={store.actions.createRoom} onJoinRoom={store.actions.joinRoom} />
        ) : null}

        {state.screen === 'LOBBY' ? (
          <LobbyScreen
            state={state}
            onSetChassis={store.actions.setChassis}
            onToggleReady={store.actions.setReady}
            onSetRoomSettings={store.actions.setRoomSettings}
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
            {portraitViewport ? (
              <section
                className="rotate-prompt"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rotate-prompt-title"
              >
                <div className="rotate-prompt__device" aria-hidden="true"><span /></div>
                <h1 id="rotate-prompt-title">Telefonu yatay çevir</h1>
                <p>Arena ve dokunmatik kontroller yatay ekranda kullanılır.</p>
              </section>
            ) : null}
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
