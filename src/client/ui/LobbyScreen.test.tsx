import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomPlayer, RoomState } from '../../shared/model.js';
import type { ClientState } from '../state/gameStore.js';
import { LobbyScreen } from './LobbyScreen.js';

function player(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    playerId: 'player-1', name: 'Ada', chassis: 'RIFT', accent: 0, ready: false, connected: true,
    reconnectRemainingMs: null,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}
function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomCode: 'AB2Z', phase: 'LOBBY', hostPlayerId: 'player-1', pauseRemainingMs: null, result: null,
    players: [player(), player({ playerId: 'player-2', name: 'Linus', chassis: 'BASTION', accent: 1, ready: true })],
    ...overrides
  };
}
function state(overrides: Partial<ClientState> = {}): ClientState {
  return {
    screen: 'LOBBY', connectionState: 'connected', room: room(), match: null,
    session: { playerId: 'player-1', roomCode: 'AB2Z', resumeToken: 'a'.repeat(64) },
    pendingAction: null, lastError: null, errorAction: null, copyFeedback: 'idle', toasts: [],
    soundMuted: false, reconnectRemainingMs: null, ...overrides
  };
}
function renderLobby(clientState = state(), handlers: Partial<Parameters<typeof LobbyScreen>[0]> = {}) {
  const props: Parameters<typeof LobbyScreen>[0] = {
    state: clientState,
    onSetChassis: vi.fn(async () => undefined),
    onToggleReady: vi.fn(async () => undefined),
    onStart: vi.fn(async () => undefined),
    onCopyRoomCode: vi.fn(async () => undefined),
    ...handlers
  };
  return { ...render(<LobbyScreen {...props} />), props };
}

describe('LobbyScreen', () => {
  afterEach(cleanup);

  it('renders four meaningful chassis silhouette buttons and no grouped color columns', () => {
    renderLobby();
    for (const chassis of ['RIFT', 'BASTION', 'PULSE', 'WRAITH']) {
      const button = screen.getByRole('button', { name: `${chassis} gövdesini seç` });
      expect(button.querySelector('.chassis-silhouette')).not.toBeNull();
    }
    expect(screen.queryByRole('heading', { name: /Camgöbeği/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Kehribar/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Maçı Başlat' })).toBeDisabled();
  });

  it('requests a chassis change without changing canonical ready presentation', () => {
    const onSetChassis = vi.fn(async () => undefined);
    renderLobby(state({ room: room({ players: [player({ ready: true }), player({ playerId: 'player-2', ready: true })] }) }), { onSetChassis });
    fireEvent.click(screen.getByRole('button', { name: 'PULSE gövdesini seç' }));
    expect(onSetChassis).toHaveBeenCalledWith('PULSE');
    expect(screen.getByRole('button', { name: 'Hazır Değilim' })).toBeVisible();
  });

  it('shows player identity, host, connection reservation, chassis, accent, and ready state', () => {
    renderLobby(state({
      room: room({ players: [
        player({ ready: true }),
        player({ playerId: 'player-2', name: 'Linus', chassis: 'WRAITH', accent: 4, connected: false, reconnectRemainingMs: 8_000 })
      ] })
    }));
    expect(screen.getByLabelText('Oda sahibi')).toBeVisible();
    expect(screen.getByText('Bağlantı bekleniyor')).toBeVisible();
    expect(within(screen.getByRole('list', { name: 'Oyuncular' })).getByText('WRAITH')).toBeVisible();
    expect(screen.getAllByText('Hazır')).not.toHaveLength(0);
  });

  it('shows host start only when all connected players are ready', () => {
    const readyRoom = room({ players: [player({ ready: true }), player({ playerId: 'player-2', ready: true })] });
    renderLobby(state({ room: readyRoom }));
    expect(screen.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    cleanup();
    renderLobby(state({ room: { ...readyRoom, hostPlayerId: 'player-2' } }));
    expect(screen.queryByRole('button', { name: 'Maçı Başlat' })).toBeNull();
  });

  it('shows copy feedback and adjacent chassis rejection without mutating the room code', () => {
    const onCopyRoomCode = vi.fn(async () => undefined);
    renderLobby(state({
      copyFeedback: 'copied',
      lastError: { code: 'INVALID_CHASSIS', message: 'Gövde seçimi geçersiz.', recoverable: true },
      errorAction: 'chassis'
    }), { onCopyRoomCode });
    const copy = screen.getByRole('button', { name: 'Kodu Kopyala' });
    expect(screen.getByTestId('room-code')).toHaveTextContent('AB2Z');
    expect(copy).toHaveTextContent('✓');
    expect(screen.getByRole('alert')).toHaveTextContent('Gövde seçimi geçersiz.');
    fireEvent.click(copy);
    expect(onCopyRoomCode).toHaveBeenCalledOnce();
  });
});
