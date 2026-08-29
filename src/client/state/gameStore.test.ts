import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Ack, Chassis, GameEvent, InputFrame, MatchSnapshot, RoomPlayer, RoomState, ServerError, SessionWelcome
} from '../../shared/model.js';
import type { GameClient, GameClientConnectionState, GameClientEvents } from '../network/GameClient.js';
import { createArenaBridge, createGameStore } from './gameStore.js';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly values = new Map<string, string>();
  readonly writes: Array<readonly [string, string]> = [];
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); this.writes.push([key, value]); }
  removeItem(key: string): void { this.values.delete(key); }
}

class FakeGameClient implements GameClient {
  private readonly listeners: { [K in keyof GameClientEvents]: Set<GameClientEvents[K]> } = {
    connection: new Set(), 'session:welcome': new Set(), 'room:state': new Set(), 'match:started': new Set(),
    'match:snapshot': new Set(), 'match:event': new Set(), 'server:error': new Set()
  };
  readonly unsubscribeCalls = vi.fn();
  connectionState: GameClientConnectionState = 'idle';
  readonly connect = vi.fn(() => undefined);
  readonly disconnect = vi.fn(() => undefined);
  readonly createRoom = vi.fn<(name: string) => Promise<Ack<SessionWelcome>>>();
  readonly joinRoom = vi.fn<(name: string, roomCode: string) => Promise<Ack<SessionWelcome>>>();
  readonly resumeSession = vi.fn<(roomCode: string, resumeToken: string) => Promise<Ack<SessionWelcome>>>();
  readonly setChassis = vi.fn<(chassis: Chassis) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly setReady = vi.fn<(ready: boolean) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly startMatch = vi.fn<() => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly sendInput = vi.fn<(input: InputFrame) => void>(() => undefined);
  readonly setResultReady = vi.fn<(ready: boolean) => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  readonly returnToLobby = vi.fn<() => Promise<Ack<null>>>(async () => ({ ok: true, data: null }));
  getConnectionState(): GameClientConnectionState { return this.connectionState; }
  subscribe<E extends keyof GameClientEvents>(event: E, listener: GameClientEvents[E]): () => void {
    this.listeners[event].add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners[event].delete(listener);
      this.unsubscribeCalls(event);
    };
  }
  emit<E extends keyof GameClientEvents>(event: E, ...args: Parameters<GameClientEvents[E]>): void {
    for (const listener of this.listeners[event]) {
      (listener as (...eventArgs: Parameters<GameClientEvents[E]>) => void)(...args);
    }
  }
}

const stats = (overrides: Partial<RoomPlayer['stats']> = {}): RoomPlayer['stats'] => ({
  knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0, ...overrides
});
function successWelcome(overrides: Partial<SessionWelcome> = {}): SessionWelcome {
  return { playerId: 'player-1', roomCode: 'AB2Z', resumeToken: 'a'.repeat(64), resumed: false, ...overrides };
}
function player(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    playerId: 'player-1', name: 'Ada', chassis: 'RIFT', accent: 0, ready: false, connected: true,
    reconnectRemainingMs: null, stats: stats(), ...overrides
  };
}
function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomCode: 'AB2Z', phase: 'LOBBY', hostPlayerId: 'player-1', pauseRemainingMs: null, result: null,
    players: [player()], ...overrides
  };
}
function matchSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    tick: 12, phase: 'REGULATION', remainingMs: 115_000, platformProgress: 0,
    scores: { 'player-1': 0 }, players: [], winnerPlayerId: null, resultReason: null, ...overrides
  };
}
function phaseEvent(overrides: Partial<Extract<GameEvent, { type: 'PHASE' }>> = {}): Extract<GameEvent, { type: 'PHASE' }> {
  return { eventId: 1, tick: 12, type: 'PHASE', phase: 'REGULATION', remainingMs: 115_000, ...overrides };
}
function createFixture(client = new FakeGameClient(), storage = new MemoryStorage()) {
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const store = createGameStore({ client, storage, clipboard });
  return { client, storage, clipboard, store };
}

describe('createGameStore', () => {
  afterEach(() => vi.useRealTimers());

  it('normalizes valid requests and exposes typed adjacent validation for raw invalid values', async () => {
    const { client, storage, store } = createFixture();
    client.joinRoom.mockResolvedValue({ ok: true, data: successWelcome() });
    await store.actions.createRoom('');
    expect(store.getSnapshot()).toMatchObject({ errorAction: 'create-room', lastError: { code: 'INVALID_NAME' } });
    expect(client.createRoom).not.toHaveBeenCalled();
    await store.actions.joinRoom('  A\u0301da  ', 'bad');
    expect(store.getSnapshot()).toMatchObject({ errorAction: 'join-room', lastError: { code: 'INVALID_ROOM_CODE' } });
    await store.actions.joinRoom('  A\u0301da  ', ' ab2z ');
    expect(client.joinRoom).toHaveBeenCalledWith('Áda', 'AB2Z');
    expect(storage.values.get('neon-relay:AB2Z:resume')).toBe('a'.repeat(64));
  });

  it('keeps chassis and ready state canonical until one authoritative room replacement arrives', async () => {
    const { client, store } = createFixture();
    client.emit('session:welcome', successWelcome());
    const canonical = roomState({ players: [player({ chassis: 'RIFT', ready: true })] });
    client.emit('room:state', canonical);
    let settleChassis!: (acknowledgement: Ack<null>) => void;
    client.setChassis.mockImplementation(() => new Promise((resolve) => { settleChassis = resolve; }));
    const pendingChassis = store.actions.setChassis('PULSE');
    expect(client.setChassis).toHaveBeenCalledWith('PULSE');
    expect(store.getSnapshot().room).toBe(canonical);
    expect(store.getSnapshot().room?.players[0]).toMatchObject({ chassis: 'RIFT', ready: true });
    expect(store.getSnapshot().pendingAction).toBe('chassis');
    const replacement = roomState({ players: [player({ chassis: 'PULSE', ready: false })] });
    client.emit('room:state', replacement);
    expect(store.getSnapshot().room).toBe(replacement);
    expect(store.getSnapshot().pendingAction).toBe('chassis');
    settleChassis({ ok: true, data: null });
    await pendingChassis;
    expect(store.getSnapshot().pendingAction).toBeNull();
  });

  it('queues exactly one resume when the transport reconnects during a pending acknowledgement', async () => {
    const client = new FakeGameClient();
    const storage = new MemoryStorage();
    storage.setItem('neon-relay:last-room', 'AB2Z');
    storage.setItem('neon-relay:AB2Z:resume', 'b'.repeat(64));
    let settleReady!: (acknowledgement: Ack<null>) => void;
    client.setReady.mockImplementation(() => new Promise((resolve) => { settleReady = resolve; }));
    client.resumeSession.mockResolvedValue({ ok: true, data: successWelcome({ resumeToken: 'b'.repeat(64), resumed: true }) });
    const { store } = createFixture(client, storage);
    const pendingReady = store.actions.setReady(true);
    client.connectionState = 'connected';
    client.emit('connection', 'connected');
    client.emit('connection', 'connected');
    expect(client.resumeSession).not.toHaveBeenCalled();
    client.emit('room:state', roomState());
    await Promise.resolve();
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(store.getSnapshot().pendingAction).toBe('ready');
    client.emit('room:state', roomState());
    client.emit('connection', 'connected');
    expect(client.resumeSession).not.toHaveBeenCalled();
    settleReady({ ok: true, data: null });
    await pendingReady;
    await vi.waitFor(() => expect(client.resumeSession).toHaveBeenCalledOnce());
    client.emit('room:state', roomState());
    client.emit('connection', 'connected');
    await Promise.resolve();
    expect(client.resumeSession).toHaveBeenCalledOnce();
  });

  it('deduplicates acknowledgement and event delivery of the same welcome', async () => {
    const { client, storage, store } = createFixture();
    const welcome = successWelcome();
    client.createRoom.mockImplementation(async () => {
      client.emit('session:welcome', welcome);
      return { ok: true, data: welcome };
    });
    let previousSession = store.getSnapshot().session;
    const sessionTransitions: Array<typeof previousSession> = [];
    store.subscribe(() => {
      const currentSession = store.getSnapshot().session;
      if (currentSession === previousSession) return;
      previousSession = currentSession;
      sessionTransitions.push(currentSession);
    });
    await store.actions.createRoom('Ada');
    expect(store.getSnapshot().session?.playerId).toBe('player-1');
    expect(sessionTransitions).toHaveLength(1);
    expect(storage.writes.filter(([key]) => key === 'neon-relay:AB2Z:resume')).toHaveLength(1);
  });

  it('counts down from the published pause duration without mutating the canonical room', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
    const { client, store } = createFixture();
    const canonical = roomState({ phase: 'MATCH', pauseRemainingMs: 12_400 });
    client.emit('room:state', canonical);
    expect(store.getSnapshot().reconnectRemainingMs).toBe(12_400);
    vi.advanceTimersByTime(1_400);
    expect(store.getSnapshot().reconnectRemainingMs).toBe(11_000);
    expect(store.getSnapshot().room).toBe(canonical);
    expect(canonical.pauseRemainingMs).toBe(12_400);
  });

  it('maps NO_CONTEST to a Turkish toast and then accepts the lobby room state', () => {
    const { client, store } = createFixture();
    client.emit('room:state', roomState({ phase: 'MATCH' }));
    client.emit('match:event', {
      eventId: 9, tick: 600, type: 'RESULT', winnerPlayerId: null, reason: 'NO_CONTEST', scores: { 'player-1': 2 }
    });
    client.emit('room:state', roomState());
    expect(store.getSnapshot().screen).toBe('LOBBY');
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({
      tone: 'warning', message: 'Rakip yeniden bağlanamadığı için maç geçersiz sayıldı.'
    });
  });

  it('keeps real-time input shaping silent during a match', () => {
    const { client, store } = createFixture();
    const rateLimited: ServerError = {
      code: 'RATE_LIMITED', message: 'Çok hızlı istek gönderiyorsunuz.', recoverable: true
    };
    client.emit('room:state', roomState({ phase: 'MATCH' }));

    client.emit('server:error', rateLimited);

    expect(store.getSnapshot()).toMatchObject({ lastError: null, errorAction: null, toasts: [] });
    client.emit('room:state', roomState({ phase: 'LOBBY' }));
    client.emit('server:error', rateLimited);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({
      tone: 'warning', message: 'Çok hızlı istek gönderiyorsunuz.'
    });
  });

  it('streams authoritative snapshots/events and creates a Phaser-free arena bridge', () => {
    const { client, store } = createFixture();
    const bridge = createArenaBridge(store);
    const snapshotListener = vi.fn();
    const eventListener = vi.fn();
    bridge.subscribeSnapshot(snapshotListener);
    bridge.subscribeEvent(eventListener);
    const snapshot = matchSnapshot();
    const event = phaseEvent();
    client.emit('match:started', snapshot);
    client.emit('match:event', event);
    bridge.sendInput({ seq: 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, quick: false, heavy: false, dash: false });
    expect(bridge.getSnapshot()).toBe(snapshot);
    expect(snapshotListener).toHaveBeenCalledWith(snapshot);
    expect(eventListener).toHaveBeenCalledWith(event);
    expect(client.sendInput).toHaveBeenCalledOnce();
  });

  it('persists mute and notifies bridge listeners only when that setting changes', () => {
    const { storage, store } = createFixture();
    const bridge = createArenaBridge(store);
    const listener = vi.fn();
    const unsubscribe = bridge.subscribeMuted(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(false);
    store.actions.toggleSound();
    store.actions.dismissToast(999);
    expect(storage.getItem('neon-relay:muted')).toBe('true');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(true);
    unsubscribe();
    store.actions.toggleSound();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exposes current connection and notifies bridge listeners once per connection change until disposal', () => {
    const { client, store } = createFixture();
    const bridge = createArenaBridge(store);
    const listener = vi.fn();

    expect(bridge.isConnected()).toBe(false);
    const unsubscribe = bridge.subscribeConnected(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(false);

    client.emit('connection', 'connected');
    client.emit('connection', 'connected');
    expect(bridge.isConnected()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(true);

    client.emit('connection', 'disconnected');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(false);

    unsubscribe();
    unsubscribe();
    client.emit('connection', 'connected');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('delivers persisted mute immediately and disposes that subscription idempotently', () => {
    const storage = new MemoryStorage();
    storage.setItem('neon-relay:muted', 'true');
    const { store } = createFixture(new FakeGameClient(), storage);
    const bridge = createArenaBridge(store);
    const listener = vi.fn();

    const unsubscribe = bridge.subscribeMuted(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
    unsubscribe();
    store.actions.toggleSound();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('sends result-ready, rematch, and host lobby-return actions without optimistic state', async () => {
    const { client, store } = createFixture();
    const canonical = roomState({ phase: 'RESULT', result: { winnerPlayerId: 'player-1', reason: 'TARGET_SCORE' } });
    client.emit('session:welcome', successWelcome());
    client.emit('room:state', canonical);
    await store.actions.setResultReady(true);
    expect(client.setResultReady).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().room).toBe(canonical);
    client.emit('room:state', canonical);
    await store.actions.startMatch();
    expect(client.startMatch).toHaveBeenCalledOnce();
    client.emit('room:state', canonical);
    await store.actions.returnToLobby();
    expect(client.returnToLobby).toHaveBeenCalledOnce();
  });

  it('disposes every client and public subscription exactly once', () => {
    const { client, store } = createFixture();
    const stateUnsubscribe = store.subscribe(vi.fn());
    const matchUnsubscribe = store.subscribeMatch(vi.fn());
    const eventUnsubscribe = store.subscribeGameEvent(vi.fn());
    stateUnsubscribe(); stateUnsubscribe();
    matchUnsubscribe(); matchUnsubscribe();
    eventUnsubscribe(); eventUnsubscribe();
    store.dispose(); store.dispose();
    expect(client.unsubscribeCalls).toHaveBeenCalledTimes(7);
    expect(client.disconnect).toHaveBeenCalledOnce();
    const before = store.getSnapshot();
    client.emit('server:error', { code: 'ROOM_FULL', message: 'Oda dolu.', recoverable: true } satisfies ServerError);
    expect(store.getSnapshot()).toBe(before);
  });
});
