import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { GAME } from '../../src/shared/constants.js';
import type { Ack, GameEvent, InputFrame, ServerError, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer, type GameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEvent = Exclude<keyof ClientToServerEvents, 'match:input'>;

const ACK_TIMEOUT_MS = 1_500;
const EVENT_TIMEOUT_MS = 5_000;

function emitAck<T>(socket: GameClient, event: AckEvent, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), ACK_TIMEOUT_MS);
    const emit = socket.emit.bind(socket) as (
      eventName: string,
      eventPayload: unknown,
      acknowledge: (acknowledgement: Ack<T>) => void
    ) => void;
    emit(event, payload, (acknowledgement) => {
      clearTimeout(timer);
      resolve(acknowledgement);
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
  const client: GameClient = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
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

const sendInput = (socket: GameClient, input: InputFrame): void => socket.emit('match:input', input);

const input = (seq: number, overrides: Partial<InputFrame> = {}): InputFrame => ({
  seq,
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  quick: false,
  heavy: false,
  dash: false,
  ...overrides
});

function unitVector(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

describe('Socket.IO FFA game server flow', () => {
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

  it('runs chassis, real hit, reconnect, five knockouts, player result, lobby, and rematch over WebSockets', async () => {
    const clientA = await client();
    const clientB = await client();
    expect(server.testHarness).not.toBeNull();
    expect((await fetch(`${origin}/__test__/knockout`)).status).toBe(404);

    const malformed = await emitAck<SessionWelcome>(clientA, 'room:create', { name: 'Ada', admin: true });
    expect(malformed).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    const host = await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    const guest = await emitSuccess<SessionWelcome>(clientB, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await emitSuccess<null>(clientA, 'lobby:chassis', { chassis: 'WRAITH' });
    await emitSuccess<null>(clientB, 'lobby:chassis', { chassis: 'PULSE' });
    await emitSuccess<null>(clientA, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientB, 'lobby:ready', { ready: true });

    const started = expectEvent(clientB, 'match:started');
    await emitSuccess<null>(clientA, 'match:start', {});
    expect((await started).players.map((player) => player.chassis).sort()).toEqual(['PULSE', 'WRAITH']);
    const regulation = await expectEvent(clientA, 'match:snapshot', (snapshot) => snapshot.phase === 'REGULATION');
    const hostPlayer = regulation.players.find((player) => player.playerId === host.playerId)!;
    const guestPlayer = regulation.players.find((player) => player.playerId === guest.playerId)!;
    const direction = unitVector(hostPlayer.position, guestPlayer.position);
    sendInput(clientA, input(1, { moveX: direction.x, moveY: direction.y, aimX: direction.x, aimY: direction.y }));
    const inRange = await expectEvent(clientA, 'match:snapshot', (snapshot) => {
      const attacker = snapshot.players.find((player) => player.playerId === host.playerId);
      const target = snapshot.players.find((player) => player.playerId === guest.playerId);
      return Boolean(attacker && target && Math.hypot(attacker.position.x - target.position.x, attacker.position.y - target.position.y) < 70);
    });
    const attackerAtRange = inRange.players.find((player) => player.playerId === host.playerId)!;
    const targetAtRange = inRange.players.find((player) => player.playerId === guest.playerId)!;
    const attackDirection = unitVector(attackerAtRange.position, targetAtRange.position);
    const hitEvent = expectEvent(clientA, 'match:event',
      (event) => event.type === 'HIT' && event.attackerId === host.playerId && event.targetId === guest.playerId);
    sendInput(clientA, input(2, { aimX: attackDirection.x, aimY: attackDirection.y, quick: true }));
    const hit = await hitEvent;
    expect(hit).toMatchObject({ type: 'HIT', attackerId: host.playerId, targetId: guest.playerId });
    const overloadBeforeDisconnect = (hit as Extract<GameEvent, { type: 'HIT' }>).resultingOverload;

    const paused = expectEvent(clientA, 'room:state',
      (state) => state.pauseRemainingMs !== null && state.pauseRemainingMs > GAME.reconnectGraceMs - 1_000 &&
        !state.players.find((player) => player.playerId === guest.playerId)?.connected);
    server.testHarness!.disconnectPlayer(host.roomCode, guest.playerId);
    await paused;
    const resumedClient = await client();
    const resumedSnapshot = expectEvent(clientA, 'match:snapshot', (snapshot) => {
      const resumed = snapshot.players.find((player) => player.playerId === guest.playerId);
      return resumed?.respawnRemainingMs === GAME.reconnectWarpMs;
    });
    const resumed = await emitSuccess<SessionWelcome>(resumedClient, 'session:resume', {
      roomCode: host.roomCode,
      resumeToken: guest.resumeToken
    });
    expect(resumed).toMatchObject({ playerId: guest.playerId, resumed: true });
    expect((await resumedSnapshot).players.find((player) => player.playerId === guest.playerId)?.overload).toBe(overloadBeforeDisconnect);
    await expectEvent(clientA, 'match:snapshot',
      (snapshot) => snapshot.players.find((player) => player.playerId === guest.playerId)?.respawnRemainingMs === 0);

    const beforeUnauthorizedHarness = server.testHarness!.matchSnapshot(host.roomCode)!;
    (clientA.emit as (event: string, payload: unknown) => void)('test:force-knockout', {
      roomCode: host.roomCode,
      attackerId: host.playerId,
      targetId: guest.playerId
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.testHarness!.matchSnapshot(host.roomCode)?.scores).toEqual(beforeUnauthorizedHarness.scores);

    const knockoutEvents: GameEvent[] = [];
    clientA.on('match:event', (event) => knockoutEvents.push(event));
    const resultStatePromise = expectEvent(clientA, 'room:state', (state) => state.phase === 'RESULT');
    for (let knockout = 0; knockout < GAME.targetScore; knockout += 1) {
      const knockedOut = expectEvent(clientA, 'match:event',
        (event) => event.type === 'KNOCKOUT' && event.targetId === guest.playerId);
      server.testHarness!.forceKnockout(host.roomCode, host.playerId, guest.playerId);
      await knockedOut;
      if (knockout < GAME.targetScore - 1) {
        await expectEvent(clientA, 'match:snapshot',
          (snapshot) => snapshot.players.find((player) => player.playerId === guest.playerId)?.respawnRemainingMs === 0);
      }
    }
    const resultState = await resultStatePromise;
    expect(knockoutEvents.filter((event) => event.type === 'KNOCKOUT')).toHaveLength(GAME.targetScore);
    expect(knockoutEvents.some(
      (event) => event.type === 'RESULT' && event.winnerPlayerId === host.playerId && event.reason === 'TARGET_SCORE'
    )).toBe(true);
    expect(resultState.players.find((player) => player.playerId === host.playerId)?.stats.knockouts).toBe(GAME.targetScore);
    expect(resultState.players.find((player) => player.playerId === guest.playerId)?.stats.falls).toBe(GAME.targetScore);
    expect(server.testHarness!.matchSnapshot(host.roomCode)).toMatchObject({
      phase: 'FINISHED',
      winnerPlayerId: host.playerId,
      resultReason: 'TARGET_SCORE',
      scores: { [host.playerId]: GAME.targetScore, [guest.playerId]: 0 }
    });

    await emitSuccess<null>(clientA, 'result:ready', { ready: true });
    await emitSuccess<null>(resumedClient, 'result:ready', { ready: true });
    const rematchStarted = expectEvent(resumedClient, 'match:started');
    await emitSuccess<null>(clientA, 'match:start', {});
    expect(await rematchStarted).toMatchObject({
      tick: 0,
      scores: { [host.playerId]: 0, [guest.playerId]: 0 },
      winnerPlayerId: null,
      resultReason: null
    });
  }, 20_000);

  it('accepts at most sixty monotonic inputs per second and silently shapes input bursts', async () => {
    const clientA = await client();
    const clientB = await client();
    const host = await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    await emitSuccess<SessionWelcome>(clientB, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await emitSuccess<null>(clientA, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientB, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientA, 'match:start', {});
    await expectEvent(clientA, 'match:snapshot', (snapshot) => snapshot.phase === 'REGULATION');

    const errors: ServerError[] = [];
    clientA.on('server:error', (error) => errors.push(error));
    for (let seq = 1; seq <= 95; seq += 1) sendInput(clientA, input(seq));
    const capped = await expectEvent(clientA, 'match:snapshot',
      (snapshot) => snapshot.players.find((player) => player.playerId === host.playerId)?.lastProcessedInputSeq === 60);
    expect(capped.players.find((player) => player.playerId === host.playerId)?.lastProcessedInputSeq).toBe(60);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors.filter((error) => error.code === 'RATE_LIMITED')).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    sendInput(clientA, input(100));
    sendInput(clientA, input(99, { moveX: -1 }));
    const monotonic = await expectEvent(clientA, 'match:snapshot',
      (snapshot) => snapshot.players.find((player) => player.playerId === host.playerId)?.lastProcessedInputSeq === 100);
    expect(monotonic.players.find((player) => player.playerId === host.playerId)?.lastProcessedInputSeq).toBe(100);
  }, 12_000);

  it('limits room actions to ten per second and suppresses repeated rate-limit events', async () => {
    const clientA = await client();
    await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const errors: ServerError[] = [];
    clientA.on('server:error', (error) => errors.push(error));
    const acknowledgements = await Promise.all(
      Array.from({ length: 14 }, (_, index) => emitAck<null>(clientA, 'lobby:ready', { ready: index % 2 === 0 }))
    );
    expect(acknowledgements.filter(
      (acknowledgement) => !acknowledgement.ok && acknowledgement.error.code === 'RATE_LIMITED'
    )).toHaveLength(4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors.filter((error) => error.code === 'RATE_LIMITED')).toHaveLength(1);
  });

  it('returns copied harness snapshots and stops cleanly', async () => {
    const clientA = await client();
    const clientB = await client();
    const host = await emitSuccess<SessionWelcome>(clientA, 'room:create', { name: 'Ada' });
    await emitSuccess<SessionWelcome>(clientB, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await emitSuccess<null>(clientA, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientB, 'lobby:ready', { ready: true });
    await emitSuccess<null>(clientA, 'match:start', {});
    const first = server.testHarness!.matchSnapshot(host.roomCode)!;
    (first.scores as Record<string, number>)[host.playerId] = 99;
    expect(server.testHarness!.matchSnapshot(host.roomCode)?.scores[host.playerId]).toBe(0);
    expect(JSON.stringify(server.testHarness)).not.toMatch(/token|expires|timestamp/iu);
  });
});
