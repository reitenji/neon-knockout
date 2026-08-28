import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientState, GameStore } from './state/gameStore.js';
import { App } from './App.js';

function storeFor(state: ClientState): GameStore {
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    dispose: vi.fn(),
    actions: {
      connect: vi.fn(),
      createRoom: vi.fn(async () => undefined),
      joinRoom: vi.fn(async () => undefined),
      setTeam: vi.fn(async () => undefined),
      setReady: vi.fn(async () => undefined),
      startMatch: vi.fn(async () => undefined),
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
  soundMuted: false
};

describe('App', () => {
  afterEach(cleanup);

  it('connects the store, renders the landing flow, and disposes on unmount', () => {
    const store = storeFor(landing);
    const view = render(<App store={store} />);

    expect(store.actions.connect).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'NEON RELAY' })).toBeVisible();
    expect(screen.getByText('Bağlı')).toBeVisible();

    view.unmount();
    expect(store.dispose).toHaveBeenCalledOnce();
  });

  it('keeps Task 5 compile-safe when canonical state advances to a match', () => {
    const matchStore = storeFor({ ...landing, screen: 'MATCH' });
    render(<App store={matchStore} />);

    expect(screen.getByLabelText('ÇEKİRDEK')).toBeVisible();
    expect(screen.getByText('WASD: Hareket')).toBeVisible();
    expect(screen.getByText('SPACE: Hamle')).toBeVisible();
  });
});
