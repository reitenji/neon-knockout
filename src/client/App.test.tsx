import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientState, GameStore } from './state/gameStore.js';
import { App } from './App.js';

function storeFor(state: ClientState): GameStore {
  return {
    getSnapshot: () => state,
    getLatestMatch: () => state.match,
    subscribe: () => () => undefined,
    subscribeMatch: () => () => undefined,
    subscribeGameEvent: () => () => undefined,
    sendInput: vi.fn(),
    dispose: vi.fn(),
    actions: {
      connect: vi.fn(),
      createRoom: vi.fn(async () => undefined),
      joinRoom: vi.fn(async () => undefined),
      setChassis: vi.fn(async () => undefined),
      setReady: vi.fn(async () => undefined),
      startMatch: vi.fn(async () => undefined),
      setResultReady: vi.fn(async () => undefined),
      returnToLobby: vi.fn(async () => undefined),
      copyRoomCode: vi.fn(async () => undefined),
      toggleSound: vi.fn(),
      dismissToast: vi.fn()
    }
  };
}

const landing: ClientState = {
  screen: 'LANDING',
  connectionState: 'connected',
  room: null,
  match: null,
  session: null,
  pendingAction: null,
  lastError: null,
  errorAction: null,
  copyFeedback: 'idle',
  toasts: [],
  soundMuted: false,
  reconnectRemainingMs: null
};

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    setViewport(1024, 768);
    vi.restoreAllMocks();
  });

  it.each([
    [899, 600],
    [900, 599]
  ])('replaces the shell with an accessible warning at %d×%d', (width, height) => {
    setViewport(width, height);
    render(<App store={storeFor(landing)} />);

    expect(screen.getByRole('main')).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('heading', { name: 'Pencere çok küçük' })).toBeVisible();
    expect(screen.getByText('Neon Knockout en az 900 × 600 masaüstü alanı gerektirir. Pencereyi büyüt.')).toBeVisible();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('renders the normal shell at the exact 900×600 minimum', () => {
    setViewport(900, 600);
    render(<App store={storeFor(landing)} />);

    expect(screen.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reacts to viewport changes and removes its resize listener on unmount', () => {
    setViewport(899, 600);
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = render(<App store={storeFor(landing)} />);
    const resizeRegistration = addListener.mock.calls.find(([event]) => event === 'resize');

    expect(resizeRegistration).toBeDefined();
    expect(screen.getByRole('alert')).toBeVisible();

    setViewport(900, 600);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(screen.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();

    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', resizeRegistration?.[1]);
  });

  it('connects the store, renders the landing flow, and disposes on unmount', () => {
    const store = storeFor(landing);
    const view = render(<App store={store} />);

    expect(store.actions.connect).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();
    expect(screen.getByText('Bağlı')).toBeVisible();

    view.unmount();
    expect(store.dispose).toHaveBeenCalledOnce();
  });

  it('keeps match content visible when the transport is connected', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const matchStore = storeFor({ ...landing, screen: 'MATCH' });
    render(<App store={matchStore} />);

    expect(screen.getByRole('main').firstElementChild).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Bağlantı kesildi' })).toBeNull();
  });

  it('keeps the match mounted under a reconnect overlay and retries through the store', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const store = storeFor({ ...landing, screen: 'MATCH', connectionState: 'disconnected', reconnectRemainingMs: 12_400 });
    render(<App store={store} />);

    expect(screen.getByRole('dialog', { name: 'Bağlantı kesildi' })).toHaveTextContent('13 saniye');
    screen.getByRole('button', { name: 'Yeniden Dene' }).click();
    expect(store.actions.connect).toHaveBeenCalledTimes(2);
  });

  it('keeps the match mounted while an authoritative opponent reservation counts down', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const store = storeFor({ ...landing, screen: 'MATCH', reconnectRemainingMs: 8_100 });
    render(<App store={store} />);

    expect(screen.getByRole('main').firstElementChild).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Rakip bekleniyor' })).toHaveTextContent('9 saniye');
  });

  it('renders canonical results and wires result-ready, rematch, and lobby return', () => {
    const store = storeFor({
      ...landing,
      screen: 'RESULT',
      room: {
        roomCode: 'AB2Z', phase: 'RESULT', hostPlayerId: 'p-1', pauseRemainingMs: null,
        result: { winnerPlayerId: 'p-1', reason: 'TARGET_SCORE' },
        players: [{
          playerId: 'p-1', name: 'Ada', chassis: 'RIFT', accent: 0, ready: false, connected: true,
          reconnectRemainingMs: null, stats: { knockouts: 5, falls: 1, landedHits: 8, completedAttacks: 10 }
        }]
      },
      session: { playerId: 'p-1', roomCode: 'AB2Z', resumeToken: 'token' }
    });
    render(<App store={store} />);
    expect(screen.getByRole('heading', { name: 'Ada Kazandı' })).toBeVisible();
    screen.getByRole('button', { name: 'Tekrar Hazır' }).click();
    expect(store.actions.setResultReady).toHaveBeenCalledWith(true);
  });
});
