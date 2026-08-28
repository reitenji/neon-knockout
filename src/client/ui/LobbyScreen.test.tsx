import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomPlayer, RoomState } from '../../shared/model.js';
import type { ClientState } from '../state/gameStore.js';
import { LobbyScreen } from './LobbyScreen.js';

function player(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    playerId: 'player-1',
    name: 'Ada',
    team: 'CYAN',
    ready: false,
    connected: true,
    stats: { deliveries: 0, tackles: 0 },
    ...overrides
  };
}

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomCode: 'AB2Z',
    phase: 'LOBBY',
    hostPlayerId: 'player-1',
    players: [player(), player({ playerId: 'player-2', name: 'Linus', team: 'AMBER', ready: true })],
    ...overrides
  };
}

function state(overrides: Partial<ClientState> = {}): ClientState {
  return {
    screen: 'LOBBY',
    connectionState: 'connected',
    room: room(),
    match: null,
    session: { playerId: 'player-1', roomCode: 'AB2Z', resumeToken: 'a'.repeat(64) },
    pendingAction: null,
    lastError: null,
    errorAction: null,
    copyFeedback: 'idle',
    toasts: [],
    soundMuted: false,
    ...overrides
  };
}

function renderLobby(clientState = state(), handlers: Partial<Parameters<typeof LobbyScreen>[0]> = {}) {
  const props: Parameters<typeof LobbyScreen>[0] = {
    state: clientState,
    onSetTeam: vi.fn(async () => undefined),
    onToggleReady: vi.fn(async () => undefined),
    onStart: vi.fn(async () => undefined),
    onCopyRoomCode: vi.fn(async () => undefined),
    ...handlers
  };
  return { ...render(<LobbyScreen {...props} />), props };
}

describe('LobbyScreen', () => {
  afterEach(cleanup);

  it('shows two teams and disables host start until every connected player is ready', () => {
    renderLobby();

    expect(screen.getByRole('heading', { name: 'Camgöbeği Takım' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Kehribar Takım' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Maçı Başlat' })).toBeDisabled();
  });

  it('does not render start controls for a non-host player', () => {
    renderLobby(
      state({
        room: room({ hostPlayerId: 'player-2', players: [player({ ready: true }), player({ playerId: 'player-2', team: 'AMBER', ready: true })] })
      })
    );

    expect(screen.queryByRole('button', { name: 'Maçı Başlat' })).toBeNull();
  });

  it('shows the host crown, disconnected reservation, and canonical ready states', () => {
    renderLobby(
      state({
        room: room({
          players: [
            player({ ready: true }),
            player({ playerId: 'player-2', name: 'Linus', team: 'AMBER', connected: false, ready: false })
          ]
        })
      })
    );

    expect(screen.getByLabelText('Oda sahibi')).toBeVisible();
    expect(screen.getByText('Bağlantı bekleniyor')).toBeVisible();
    expect(screen.getAllByText('Hazır')).not.toHaveLength(0);
  });

  it('offers team switching and renders a server rejection beside the controls', () => {
    const onSetTeam = vi.fn(async () => undefined);
    renderLobby(
      state({
        lastError: {
          code: 'UNBALANCED_TEAM',
          message: 'Takım değişikliği takımları dengesiz bırakır.',
          recoverable: true
        },
        errorAction: 'team'
      }),
      { onSetTeam }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Kehribar Takım' }));
    expect(onSetTeam).toHaveBeenCalledWith('AMBER');
    expect(screen.getByRole('alert')).toHaveTextContent('Takım değişikliği takımları dengesiz bırakır.');
  });

  it('shows copy feedback without changing the room code and keeps focus styles visible', () => {
    const onCopyRoomCode = vi.fn(async () => undefined);
    renderLobby(state({ copyFeedback: 'copied' }), { onCopyRoomCode });

    const copyButton = screen.getByRole('button', { name: 'Kodu Kopyala' });
    expect(screen.getByTestId('room-code')).toHaveTextContent('AB2Z');
    expect(copyButton).toHaveTextContent('✓');
    expect(copyButton).toHaveClass('focus-ring');
    fireEvent.click(copyButton);
    expect(onCopyRoomCode).toHaveBeenCalledOnce();
  });
});
