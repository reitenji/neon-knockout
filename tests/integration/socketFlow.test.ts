import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Ack, GameEvent, ServerError, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer, type GameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEvent =
  | 'room:create'
  | 'room:join'
  | 'session:resume'
  | 'lobby:team'
  | 'lobby:ready'
  | 'match:start'
  | 'result:ready'
  | 'result:lobby';

const ACK_TIMEOUT_MS = 1_500;
const EVENT_TIMEOUT_MS = 5_000;

function emitAck<T>(socket: GameClient, event: AckEvent, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), ACK_TIMEOUT_MS);
    const emit = socket.emit.bind(socket) as (
      eventName: string,
      eventPayload: unknown,
      acknowledge: (ack: Ack<T>) => void
    ) => void;
    emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function emitSuccess<T>(socket: GameClient, event: AckEvent, payload: unknown): Promise<T> {
  const acknowledgement = await emitAck<T>(socket, event, payload);
  if (!acknowledgement.ok) throw new Error(`${acknowledgement.error.code}: ${acknowledgement.error.message}`);
  return acknowledgement.data;
}

function expectEvent<E extends keyof ServerToClientEvents>(
  socket: GameClient,
  event: E,
  predicate: (value: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
  timeoutMs = EVENT_TIMEOUT_MS
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  type EventValue = Parameters<ServerToClientEvents[E]>[0];
  return new Promise((resolve, reject) => {
    const on = socket.on.bind(socket) as (eventName: string, listener: (value: EventValue) => void) => void;
    const off = socket.off.bind(socket) as (eventName: string, listener: (value: EventValue) => void) => void;
    const listener = (value: EventValue): void => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      off(event, listener);
      resolve(value);
    };
    const timer = setTimeout(() => {
      off(event, listener);
      reject(new Error(`Timed out waiting for ${String(event)}`));
    }, timeoutMs);
    on(event, listener);
  });
}

async function connectClient(origin: string): Promise<GameClient> {
  const client: GameClient = io(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting Socket.IO client')), ACK_TIMEOUT_MS);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return client;
}

function sendInput(socket: GameClient, seq: number): void {
  socket.emit('match:input', {
    seq,
    up: false,
    down: false,
    left: false,
    right: true,
    dash: false
  });
}

describe('Socket.IO game server flow', () => {
  let server: GameServer;
  let origin: string;
  let clients: GameClient[];

  beforeEach(async () => {
    server = createGameServer({ host: '127.0.0.1', port: 0, enableTestHarness: true, clientDirectory: false });
    ({ origin } = await server.start());
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await server.stop();
  });

  const client = async (): Promise<GameClient> => {
    const connected = await connectClient(origin);
    clients.push(connected);
    return connected;
  };

  it('runs create, join, match, authoritative input, result, lobby, and rematch over real WebSockets', async () => {
    const clientA = await client();
    const clientB = await client();

    expect(await fetch(`${origin}/health`).then((response) => response.json())).toMatchObject({
      status: 'ok',
      rooms: 0
    });
    expect(server.testHarness).not.toBeNull();
    expect((await fetch(`${origin}/__test__/deliver`)).status).toBe(404);

    const malformed = await emitAck<SessionWelcome>(clientA, 'room:create', { name: 'Ada', admin: true });
    expect(malformed).toEqual({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: 'İstek verisi geçersiz.', recoverable: true }
    });

    const room = await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    const joined = await emitSuccess<SessionWelcome>(clientB, 'room:join', {
      name: 'Linus',
      roomCode: room.roomCode
    });
    expect(joined.roomCode).toBe(room.roomCode);

    const unauthorized = await emitAck<null>(clientB, 'match:start', {});
    expect(unauthorized).toEqual({
      ok: false,
      error: { code: 'NOT_HOST', message: 'Bu işlemi yalnızca oda sahibi yapabilir.', recoverable: true }
    });

    const prematureInputError = expectEvent(clientA, 'server:error', (error) => error.code === 'INVALID_PHASE');
    sendInput(clientA, 999);
    expect(await prematureInputError).toMatchObject({ code: 'INVALID_PHASE' });

    await emitSuccess<null>(clientA, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientB, 'lobby:ready', { ready: true });
    const startedEvent = expectEvent(clientB, 'match:started');
    await emitSuccess<null>(clientA, 'match:start', {});
    expect((await startedEvent).phase).toBe('COUNTDOWN');

    const lateClient = await client();
    const lateJoin = await emitAck<SessionWelcome>(lateClient, 'room:join', {
      name: 'Grace',
      roomCode: room.roomCode
    });
    expect(lateJoin).toMatchObject({ ok: false, error: { code: 'MATCH_IN_PROGRESS' } });

    await expectEvent(clientB, 'match:snapshot', (snapshot) => snapshot.phase === 'REGULATION');

    const rateErrors: ServerError[] = [];
    clientA.on('server:error', (error) => rateErrors.push(error));
    for (let seq = 1; seq <= 65; seq += 1) sendInput(clientA, seq);
    const afterBurst = await expectEvent(
      clientA,
      'match:snapshot',
      (snapshot) => snapshot.players.some((player) => player.playerId === room.playerId && player.lastProcessedInputSeq >= 60)
    );
    expect(afterBurst.players.find((player) => player.playerId === room.playerId)?.lastProcessedInputSeq).toBe(60);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rateErrors).toEqual([
      { code: 'RATE_LIMITED', message: 'Çok hızlı istek gönderiyorsunuz.', recoverable: true }
    ]);

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    sendInput(clientA, 70);
    sendInput(clientA, 69);
    const monotonic = await expectEvent(
      clientA,
      'match:snapshot',
      (snapshot) => snapshot.players.some((player) => player.playerId === room.playerId && player.lastProcessedInputSeq === 70)
    );
    expect(monotonic.players.find((player) => player.playerId === room.playerId)?.lastProcessedInputSeq).toBe(70);

    const scoreEvents: GameEvent[] = [];
    clientB.on('match:event', (event) => scoreEvents.push(event));
    for (let score = 0; score < 7; score += 1) server.testHarness!.deliverCore(room.roomCode, 'CYAN');
    const resultState = await expectEvent(clientB, 'room:state', (state) => state.phase === 'RESULT');
    expect(scoreEvents.filter((event) => event.type === 'SCORE')).toHaveLength(7);
    expect(scoreEvents.some((event) => event.type === 'RESULT' && event.winner === 'CYAN')).toBe(true);
    expect(resultState.players.find((player) => player.playerId === room.playerId)?.stats.deliveries).toBe(7);
    expect(server.testHarness!.matchSnapshot(room.roomCode)).toMatchObject({
      phase: 'FINISHED',
      score: { CYAN: 7, AMBER: 0 },
      winner: 'CYAN'
    });

    await emitSuccess<null>(clientA, 'result:ready', { ready: true });
    const bothReady = expectEvent(clientA, 'room:state', (state) => state.players.every((player) => player.ready));
    await emitSuccess<null>(clientB, 'result:ready', { ready: true });
    expect((await bothReady).players.every((player) => player.ready)).toBe(true);
    expect(await emitAck<null>(clientB, 'result:lobby', {})).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });

    const lobbyState = expectEvent(clientB, 'room:state', (state) => state.phase === 'LOBBY');
    await emitSuccess<null>(clientA, 'result:lobby', {});
    expect((await lobbyState).players.every((player) => !player.ready)).toBe(true);

    await emitSuccess<null>(clientA, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientB, 'lobby:ready', { ready: true });
    const rematchStarted = expectEvent(clientB, 'match:started');
    await emitSuccess<null>(clientA, 'match:start', {});
    expect(await rematchStarted).toMatchObject({ score: { CYAN: 0, AMBER: 0 } });
  }, 15_000);

  it('migrates the host on a forced disconnect and resumes the same player identity', async () => {
    const clientA = await client();
    const clientB = await client();
    const room = await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    const guest = await emitSuccess<SessionWelcome>(clientB, 'room:join', { name: 'Linus', roomCode: room.roomCode });

    const migratedState = expectEvent(
      clientB,
      'room:state',
      (state) => state.hostPlayerId === guest.playerId && state.players.some((player) => player.playerId === room.playerId && !player.connected)
    );
    server.testHarness!.disconnectPlayer(room.roomCode, room.playerId);
    expect((await migratedState).hostPlayerId).toBe(guest.playerId);

    const resumedClient = await client();
    const resumedState = expectEvent(
      clientB,
      'room:state',
      (state) => state.players.some((player) => player.playerId === room.playerId && player.connected)
    );
    const resumed = await emitSuccess<SessionWelcome>(resumedClient, 'session:resume', {
      roomCode: room.roomCode,
      resumeToken: room.resumeToken
    });
    expect(resumed).toMatchObject({ playerId: room.playerId, resumed: true });
    expect((await resumedState).hostPlayerId).toBe(guest.playerId);
  });

  it('limits room actions to ten per second and suppresses repeated rate-limit events', async () => {
    const clientA = await client();
    await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const errors: ServerError[] = [];
    clientA.on('server:error', (error) => errors.push(error));
    const acknowledgements = await Promise.all(
      Array.from({ length: 14 }, (_, index) => emitAck<null>(clientA, 'lobby:ready', { ready: index % 2 === 0 }))
    );
    expect(acknowledgements.filter((acknowledgement) => !acknowledgement.ok && acknowledgement.error.code === 'RATE_LIMITED')).toHaveLength(4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors.filter((error) => error.code === 'RATE_LIMITED')).toHaveLength(1);
  });
});
