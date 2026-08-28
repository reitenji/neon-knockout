import { describe, expect, it, vi } from 'vitest';
import type { Ack, GameEvent, InputFrame, MatchSnapshot, RoomState, ServerError, SessionWelcome, Team } from '../../shared/model.js';
import type { GameClient, GameClientConnectionState, GameClientEvents } from '../network/GameClient.js';
import { createGameStore } from './gameStore.js';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeGameClient implements GameClient {
  private readonly listeners: { [K in keyof GameClientEvents]: Set<GameClientEvents[K]> } = {
    connection: new Set(),
    'session:welcome': new Set(),
    'room:state': new Set(),
    'match:started': new Set(),
    'match:snapshot': new Set(),
    'match:event': new Set(),
    'server:error': new Set()
  };

  connectionState: GameClientConnectionState = 'idle';
  readonly connect = vi.fn(() => undefined);
  readonly disconnect = vi.fn(() => undefined);
  readonly createRoom = vi.fn<(name: string) => Promise<Ack<SessionWelcome>>>();
  readonly joinRoom = vi.fn<(name: string, roomCode: string) => Promise<Ack<SessionWelcome>>>();
  readonly resumeSession = vi.fn<(roomCode: string, resumeToken: string) => Promise<Ack<SessionWelcome>>>();
  readonly setTeam = vi.fn<(team: Team) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly setReady = vi.fn<(ready: boolean) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly startMatch = vi.fn<() => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly sendInput = vi.fn<(input: InputFrame) => void>(() => undefined);
  readonly setResultReady = vi.fn<(ready: boolean) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly returnToLobby = vi.fn<() => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));

  getConnectionState(): GameClientConnectionState {
    return this.connectionState;
  }

  subscribe<E extends keyof GameClientEvents>(event: E, listener: GameClientEvents[E]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  emit<E extends keyof GameClientEvents>(event: E, ...args: Parameters<GameClientEvents[E]>): void {
    for (const listener of this.listeners[event]) {
      (listener as (...eventArgs: Parameters<GameClientEvents[E]>) => void)(...args);
    }
  }
}

function successWelcome(overrides: Partial<SessionWelcome> = {}): SessionWelcome {
  return {
    playerId: 'player-1',
    roomCode: 'AB2Z',
    resumeToken: 'a'.repeat(64),
    resumed: false,
    ...overrides
  };
}

function player(overrides: Partial<RoomState['players'][number]> = {}): RoomState['players'][number] {
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

function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomCode: 'AB2Z',
    phase: 'LOBBY',
    hostPlayerId: 'player-1',
    players: [player()],
    ...overrides
  };
}

function createFixture(client = new FakeGameClient(), storage = new MemoryStorage()) {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const store = createGameStore({ client, storage, clipboard });
  return { client, storage, clipboard, store };
}

describe('createGameStore', () => {
  it('normalizes requests and persists the exact room-scoped resume keys', async () => {
    const { client, storage, store } = createFixture();
    client.joinRoom.mockResolvedValue({ ok: true, data: successWelcome() });

    await store.actions.joinRoom('  A\u0301da  ', ' ab2z ');

    expect(client.joinRoom).toHaveBeenCalledWith('Áda', 'AB2Z');
    expect(storage.values.get('neon-relay:AB2Z:resume')).toBe('a'.repeat(64));
    expect(storage.values.get('neon-relay:last-room')).toBe('AB2Z');
    expect(store.getSnapshot().session).toEqual({
      playerId: 'player-1',
      roomCode: 'AB2Z',
      resumeToken: 'a'.repeat(64)
    });
  });

  it('keeps canonical room state unchanged until the server replaces it', async () => {
    const { client, store } = createFixture();
    client.createRoom.mockResolvedValue({ ok: true, data: successWelcome() });
    await store.actions.createRoom('Ada');
    const canonical = roomState();
    client.emit('room:state', canonical);

    await store.actions.setTeam('AMBER');

    expect(store.getSnapshot().room).toBe(canonical);
    expect(store.getSnapshot().room?.players[0]?.team).toBe('CYAN');
    expect(store.getSnapshot().pendingAction).toBe('team');

    const replacement = roomState({ players: [player({ team: 'AMBER' })] });
    client.emit('room:state', replacement);
    expect(store.getSnapshot().room).toBe(replacement);
    expect(store.getSnapshot().pendingAction).toBeNull();
  });

  it('surfaces a team-switch failure without mutating the canonical team', async () => {
    const { client, store } = createFixture();
    client.createRoom.mockResolvedValue({ ok: true, data: successWelcome() });
    await store.actions.createRoom('Ada');
    client.emit('room:state', roomState());
    client.setTeam.mockResolvedValue({
      ok: false,
      error: {
        code: 'UNBALANCED_TEAM',
        message: 'Takım değişikliği takımları dengesiz bırakır.',
        recoverable: true
      }
    });

    await store.actions.setTeam('AMBER');

    expect(store.getSnapshot().room?.players[0]?.team).toBe('CYAN');
    expect(store.getSnapshot().lastError?.code).toBe('UNBALANCED_TEAM');
    expect(store.getSnapshot().errorAction).toBe('team');
    expect(store.getSnapshot().pendingAction).toBeNull();
  });

  it('resumes the last room after connecting and removes only a rejected room token', async () => {
    const client = new FakeGameClient();
    const storage = new MemoryStorage();
    storage.setItem('neon-relay:last-room', 'AB2Z');
    storage.setItem('neon-relay:AB2Z:resume', 'b'.repeat(64));
    storage.setItem('neon-relay:CD3Y:resume', 'c'.repeat(64));
    client.resumeSession.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_RESUME_TOKEN',
        message: 'Yeniden bağlanma anahtarı geçersiz veya süresi dolmuş.',
        recoverable: true
      }
    });
    const { store } = createFixture(client, storage);

    store.actions.connect();
    client.connectionState = 'connected';
    client.emit('connection', 'connected');
    await vi.waitFor(() => expect(client.resumeSession).toHaveBeenCalledWith('AB2Z', 'b'.repeat(64)));

    expect(storage.getItem('neon-relay:AB2Z:resume')).toBeNull();
    expect(storage.getItem('neon-relay:last-room')).toBeNull();
    expect(storage.getItem('neon-relay:CD3Y:resume')).toBe('c'.repeat(64));
    expect(store.getSnapshot().lastError?.code).toBe('INVALID_RESUME_TOKEN');
  });

  it('publishes copy feedback and cleans subscriptions on dispose', async () => {
    const { client, clipboard, store } = createFixture();
    client.createRoom.mockResolvedValue({ ok: true, data: successWelcome() });
    await store.actions.createRoom('Ada');
    client.emit('room:state', roomState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.actions.copyRoomCode();
    expect(clipboard.writeText).toHaveBeenCalledWith('AB2Z');
    expect(store.getSnapshot().copyFeedback).toBe('copied');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    store.dispose();
    expect(client.disconnect).toHaveBeenCalledOnce();
    const snapshotBefore = store.getSnapshot();
    client.emit('server:error', {
      code: 'ROOM_FULL',
      message: 'Oda dolu.',
      recoverable: true
    } satisfies ServerError);
    expect(store.getSnapshot()).toBe(snapshotBefore);
  });

  it('replaces match snapshots and forwards no speculative game state', () => {
    const { client, store } = createFixture();
    const match: MatchSnapshot = {
      tick: 12,
      phase: 'REGULATION',
      remainingMs: 175_000,
      score: { CYAN: 1, AMBER: 0 },
      players: [],
      cores: [],
      winner: null
    };
    const event: GameEvent = { type: 'PHASE', phase: 'REGULATION' };

    client.emit('match:started', match);
    client.emit('match:event', event);

    expect(store.getSnapshot().match).toBe(match);
    expect(store.getSnapshot().screen).toBe('MATCH');
  });
});
