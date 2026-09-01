import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { GAME } from '../../src/shared/constants.js';
import type { Ack, GameEvent, InputFrame, MatchSnapshot, ServerError, SessionWelcome, Vec2 } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer, type GameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEvent = Exclude<keyof ClientToServerEvents, 'match:input'>;

const ACK_TIMEOUT_MS = 1_500;
const EVENT_TIMEOUT_MS = 5_000;
const STEP_MS = 1_000 / GAME.tickRate;

type StartedMatch = Readonly<{
  roomCode: string;
  host: SessionWelcome;
  guest: SessionWelcome;
  hostClient: GameClient;
  guestClient: GameClient;
}>;

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
  client.on('network:probe', (acknowledge) => acknowledge());
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

function player(snapshot: MatchSnapshot, playerId: string) {
  const value = snapshot.players.find((candidate) => candidate.playerId === playerId);
  if (!value) throw new Error(`Missing player ${playerId} in authoritative snapshot.`);
  return value;
}

describe('Socket.IO FFA game server flow', () => {
  let server: GameServer;
  let origin: string;
  let clients: GameClient[];
  let sequences: Map<GameClient, number>;

  beforeEach(async () => {
    server = createGameServer({ host: '127.0.0.1', port: 0, enableTestHarness: true, clientDirectory: false });
    ({ origin } = await server.start());
    clients = [];
    sequences = new Map();
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await server.stop();
  });

  const client = async (): Promise<GameClient> => {
    const connected = await connectClient(origin);
    clients.push(connected);
    sequences.set(connected, 0);
    return connected;
  };

  const harness = () => {
    if (!server.testHarness) throw new Error('Integration server requires its in-process test harness.');
    return server.testHarness;
  };

  const snapshot = (roomCode: string): MatchSnapshot => {
    const value = harness().matchSnapshot(roomCode);
    if (!value) throw new Error(`Missing authoritative snapshot for ${roomCode}.`);
    return value;
  };

  const waitFor = async (predicate: () => boolean, label: string, timeoutMs = EVENT_TIMEOUT_MS): Promise<void> => {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const advanceUntil = (
    roomCode: string,
    predicate: (value: MatchSnapshot) => boolean,
    label: string,
    maximumMs: number
  ): MatchSnapshot => {
    const maximumSteps = Math.ceil(maximumMs / STEP_MS) + 2;
    for (let step = 0; step <= maximumSteps; step += 1) {
      const current = snapshot(roomCode);
      if (predicate(current)) return current;
      server.rooms.advance(STEP_MS);
    }
    throw new Error(`Timed out advancing the authoritative simulation to ${label}: ${JSON.stringify(snapshot(roomCode))}`);
  };

  const advanceBy = (roomCode: string, elapsedMs: number): MatchSnapshot => {
    const targetTick = snapshot(roomCode).tick + Math.ceil(elapsedMs / STEP_MS);
    return advanceUntil(roomCode, (value) => value.tick >= targetTick, `${elapsedMs} ms`, elapsedMs + STEP_MS * 4);
  };

  const startMatch = async (): Promise<StartedMatch> => {
    const hostClient = await client();
    const guestClient = await client();
    const host = await emitSuccess<SessionWelcome>(hostClient, 'room:create', { name: 'Ada' });
    const guest = await emitSuccess<SessionWelcome>(guestClient, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await emitSuccess<null>(hostClient, 'lobby:chassis', { chassis: 'WRAITH' });
    await emitSuccess<null>(guestClient, 'lobby:chassis', { chassis: 'PULSE' });
    await emitSuccess<null>(hostClient, 'lobby:ready', { ready: true });
    await emitSuccess<null>(guestClient, 'lobby:ready', { ready: true });
    await emitSuccess<null>(hostClient, 'match:start', {});
    advanceUntil(host.roomCode, (value) => value.phase === 'REGULATION', 'regulation', GAME.countdownMs + 100);
    return { roomCode: host.roomCode, host, guest, hostClient, guestClient };
  };

  const submitFrames = async (
    match: StartedMatch,
    frames: readonly Readonly<{ client: GameClient; playerId: string; overrides?: Partial<InputFrame> }>[]
  ): Promise<void> => {
    const submitted = frames.map(({ client: socket, playerId, overrides }) => {
      const seq = sequences.get(socket) ?? 0;
      sequences.set(socket, seq + 1);
      socket.emit('match:input', input(seq, overrides));
      return { playerId, seq };
    });
    await waitFor(() => {
      const current = harness().matchSnapshot(match.roomCode);
      return Boolean(current && submitted.every(({ playerId, seq }) => player(current, playerId).lastProcessedInputSeq >= seq));
    }, `input frames ${submitted.map(({ seq }) => seq).join(', ')}`);
  };

  const prepare = async (
    match: StartedMatch,
    hostPosition: Vec2 = { x: 580, y: 360 },
    guestPosition: Vec2 = { x: 650, y: 360 },
    hostFacing: Vec2 = { x: 1, y: 0 },
    guestFacing: Vec2 = { x: -1, y: 0 }
  ): Promise<void> => {
    advanceUntil(match.roomCode, (value) => value.players.every((candidate) =>
      candidate.action.kind === null && candidate.hitstunRemainingMs === 0 &&
      candidate.dashRemainingMs === 0 && candidate.respawnRemainingMs === 0
    ), 'neutral fighters', 2_000);
    harness().placePlayer(match.roomCode, match.host.playerId, hostPosition, hostFacing);
    harness().placePlayer(match.roomCode, match.guest.playerId, guestPosition, guestFacing);
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: hostFacing.x, aimY: hostFacing.y } },
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: guestFacing.x, aimY: guestFacing.y } }
    ]);
  };

  const eventMarker = (roomCode: string): number => harness().recentEvents(roomCode).at(-1)?.eventId ?? 0;
  const eventsAfter = (roomCode: string, marker: number): readonly GameEvent[] =>
    harness().recentEvents(roomCode).filter((event) => event.eventId > marker);
  const eventAfter = <T extends GameEvent['type']>(
    roomCode: string,
    marker: number,
    type: T,
    predicate: (event: Extract<GameEvent, { type: T }>) => boolean = () => true
  ): Extract<GameEvent, { type: T }> | null =>
    eventsAfter(roomCode, marker).find((event): event is Extract<GameEvent, { type: T }> =>
      event.type === type && predicate(event as Extract<GameEvent, { type: T }>)) ?? null;

  const advanceToEvent = <T extends GameEvent['type']>(
    match: StartedMatch,
    marker: number,
    type: T,
    maximumMs: number,
    predicate: (event: Extract<GameEvent, { type: T }>) => boolean = () => true
  ): Extract<GameEvent, { type: T }> => {
    advanceUntil(match.roomCode, () => eventAfter(match.roomCode, marker, type, predicate) !== null, type, maximumMs);
    return eventAfter(match.roomCode, marker, type, predicate)!;
  };

  const quick = async (
    match: StartedMatch,
    entries: readonly Readonly<{ client: GameClient; playerId: string; aim: Vec2 }>[]
  ): Promise<void> => {
    await submitFrames(match, entries.map(({ client: socket, playerId, aim }) => ({
      client: socket,
      playerId,
      overrides: { aimX: aim.x, aimY: aim.y, quick: true }
    })));
    await submitFrames(match, entries.map(({ client: socket, playerId, aim }) => ({
      client: socket,
      playerId,
      overrides: { aimX: aim.x, aimY: aim.y }
    })));
  };

  const charge = async (
    match: StartedMatch,
    entries: readonly Readonly<{ client: GameClient; playerId: string; aim: Vec2 }>[]
  ): Promise<void> => {
    await submitFrames(match, entries.map(({ client: socket, playerId, aim }) => ({
      client: socket,
      playerId,
      overrides: { aimX: aim.x, aimY: aim.y, heavy: true }
    })));
  };

  const releaseHeavy = async (
    match: StartedMatch,
    entries: readonly Readonly<{ client: GameClient; playerId: string; aim: Vec2 }>[]
  ): Promise<void> => {
    await submitFrames(match, entries.map(({ client: socket, playerId, aim }) => ({
      client: socket,
      playerId,
      overrides: { aimX: aim.x, aimY: aim.y }
    })));
  };

  it('synchronizes strict host room settings, resets readiness, and rejects guest or malformed writes', async () => {
    const hostClient = await client();
    const guestClient = await client();
    const host = await emitSuccess<SessionWelcome>(hostClient, 'room:create', { name: 'Ada' });
    await emitSuccess<SessionWelcome>(guestClient, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await emitSuccess<null>(hostClient, 'lobby:ready', { ready: true });
    await emitSuccess<null>(guestClient, 'lobby:ready', { ready: true });

    const hostUpdate = expectEvent(hostClient, 'room:state', (state) =>
      state.settings.durationMs === 90_000 && state.settings.knockoutTarget === 3 &&
      state.players.every((candidate) => !candidate.ready));
    const guestUpdate = expectEvent(guestClient, 'room:state', (state) =>
      state.settings.durationMs === 90_000 && state.settings.knockoutTarget === 3 &&
      state.players.every((candidate) => !candidate.ready));
    expect(await emitAck<null>(hostClient, 'lobby:settings', { durationMs: 90_000, knockoutTarget: 3 }))
      .toEqual({ ok: true, data: null });
    expect((await hostUpdate).settings).toEqual({ durationMs: 90_000, knockoutTarget: 3 });
    expect((await guestUpdate).settings).toEqual({ durationMs: 90_000, knockoutTarget: 3 });

    const observed: RoomState[] = [];
    hostClient.on('room:state', (state) => observed.push(state));
    expect(await emitAck<null>(guestClient, 'lobby:settings', { durationMs: 120_000, knockoutTarget: 5 }))
      .toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await emitAck<null>(hostClient, 'lobby:settings', { durationMs: 100_000, knockoutTarget: 5 }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(await emitAck<null>(hostClient, 'lobby:settings', { durationMs: 120_000, knockoutTarget: 5, map: 'void' }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(observed.some((state) => state.settings.durationMs !== 90_000 || state.settings.knockoutTarget !== 3)).toBe(false);
  });

  it('promptly measures RTT after a match starts and ignores forged client latency events', async () => {
    const match = await startMatch();
    await waitFor(
      () => snapshot(match.roomCode).pingMs[match.host.playerId] !== null,
      'first server-issued RTT sample after match start',
      750
    );
    const measured = snapshot(match.roomCode);
    expect(measured.pingMs[match.host.playerId]).toEqual(expect.any(Number));
    expect(measured.pingMs[match.host.playerId]).toBeLessThan(GAME.maxPingMs);

    const emit = match.hostClient.emit.bind(match.hostClient) as (event: string, payload: unknown) => void;
    emit('network:latency', { pingMs: GAME.maxPingMs });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(snapshot(match.roomCode).pingMs[match.host.playerId]).not.toBe(GAME.maxPingMs);
  });

  it('leaves the Socket.IO room, clears the connection mapping, invalidates resume, and reuses the same socket', async () => {
    const hostClient = await client();
    const guestClient = await client();
    const host = await emitSuccess<SessionWelcome>(hostClient, 'room:create', { name: 'Ada' });
    const guest = await emitSuccess<SessionWelcome>(guestClient, 'room:join', { name: 'Linus', roomCode: host.roomCode });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(await emitAck<null>(guestClient, 'room:leave', { extra: true }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    const oldRoomStates: RoomState[] = [];
    guestClient.on('room:state', (state) => {
      if (state.roomCode === host.roomCode) oldRoomStates.push(state);
    });
    const hostRoster = expectEvent(hostClient, 'room:state', (state) =>
      state.roomCode === host.roomCode && state.players.length === 1);
    expect(await emitAck<null>(guestClient, 'room:leave', {})).toEqual({ ok: true, data: null });
    expect((await hostRoster).players.map((candidate) => candidate.playerId)).toEqual([host.playerId]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(oldRoomStates).toEqual([]);

    harness().disconnectPlayer(host.roomCode, guest.playerId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(guestClient.connected).toBe(true);

    const replacement = await emitSuccess<SessionWelcome>(guestClient, 'room:create', { name: 'Yeni Linus' });
    expect(replacement.roomCode).not.toBe(host.roomCode);
    const resumeClient = await client();
    expect(await emitAck<SessionWelcome>(resumeClient, 'session:resume', {
      roomCode: host.roomCode,
      resumeToken: guest.resumeToken
    })).toMatchObject({ ok: false, error: { code: 'INVALID_RESUME_TOKEN' } });

    await emitSuccess<null>(hostClient, 'lobby:settings', { durationMs: 90_000, knockoutTarget: 3 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(oldRoomStates).toEqual([]);
  });

  it('keeps deterministic placement and cloned event history private to an enabled in-process harness', async () => {
    const production = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    expect(production.testHarness).toBeNull();
    await production.stop();
    expect((await fetch(`${origin}/__test__/knockout`)).status).toBe(404);

    const match = await startMatch();
    const position = { x: 520, y: 320 };
    const facing = { x: 0, y: 1 };
    harness().placePlayer(match.roomCode, match.host.playerId, position, facing);
    position.x = 999;
    facing.y = -1;
    expect(player(snapshot(match.roomCode), match.host.playerId)).toMatchObject({
      position: { x: 520, y: 320 },
      facing: { x: 0, y: 1 }
    });

    const marker = eventMarker(match.roomCode);
    await quick(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    advanceBy(match.roomCode, 250);
    const returned = harness().recentEvents(match.roomCode);
    expect(returned.length).toBeGreaterThan(0);
    (returned.at(-1)! as { eventId: number }).eventId = marker + 10_000;
    expect(harness().recentEvents(match.roomCode).at(-1)?.eventId).not.toBe(marker + 10_000);
    expect(JSON.stringify(server.testHarness)).not.toMatch(/token|expires|timestamp/iu);
  });

  it('serves the SPA fallback when the built client lives under a dotted worktree path', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'neon-static-'));
    const clientDirectory = join(temporaryRoot, '.worktree', 'dist', 'client');
    await mkdir(clientDirectory, { recursive: true });
    await writeFile(join(clientDirectory, 'index.html'), '<main>Neon fallback</main>');
    const staticServer = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory });
    const address = await staticServer.start();
    try {
      const response = await fetch(`${address.origin}/favicon.ico`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<main>Neon fallback</main>');
    } finally {
      await staticServer.stop();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('lets only the host change room settings and seeds the started match from that authoritative pair', async () => {
    const hostClient = await client();
    const guestClient = await client();
    const host = await emitSuccess<SessionWelcome>(hostClient, 'room:create', { name: 'Ada' });
    await emitSuccess<SessionWelcome>(guestClient, 'room:join', { name: 'Linus', roomCode: host.roomCode });

    const guestRejection = await emitAck<null>(guestClient, 'lobby:settings', { durationMs: 90_000, knockoutTarget: 3 });
    expect(guestRejection).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_HOST',
        recoverable: true
      }
    });

    const hostRoomUpdate = expectEvent(
      hostClient,
      'room:state',
      (state) => state.roomCode === host.roomCode && state.settings.durationMs === 180_000 && state.settings.knockoutTarget === 7
    );
    const guestRoomUpdate = expectEvent(
      guestClient,
      'room:state',
      (state) => state.roomCode === host.roomCode && state.settings.durationMs === 180_000 && state.settings.knockoutTarget === 7
    );
    await emitSuccess<null>(hostClient, 'lobby:settings', { durationMs: 180_000, knockoutTarget: 7 });
    await expect(hostRoomUpdate).resolves.toMatchObject({
      settings: { durationMs: 180_000, knockoutTarget: 7 }
    });
    await expect(guestRoomUpdate).resolves.toMatchObject({
      settings: { durationMs: 180_000, knockoutTarget: 7 }
    });

    await emitSuccess<null>(hostClient, 'lobby:ready', { ready: true });
    await emitSuccess<null>(guestClient, 'lobby:ready', { ready: true });
    const startedPromise = expectEvent(
      hostClient,
      'match:started',
      (snapshot) => snapshot.settings.durationMs === 180_000 && snapshot.settings.knockoutTarget === 7
    );
    await emitSuccess<null>(hostClient, 'match:start', {});
    const started = await startedPromise;
    expect(started.settings).toEqual({ durationMs: 180_000, knockoutTarget: 7 });
  });

  it('keeps the socket reusable after an active leave and returns survivors to the lobby with preserved settings', async () => {
    const match = await startMatch();
    const roomUpdate = expectEvent(
      match.guestClient,
      'room:state',
      (state) =>
        state.roomCode === match.roomCode &&
        state.phase === 'LOBBY' &&
        state.players.length === 1 &&
        state.players[0]?.playerId === match.guest.playerId
    );

    await emitSuccess<null>(match.hostClient, 'room:leave', {});
    await expect(roomUpdate).resolves.toMatchObject({
      hostPlayerId: match.guest.playerId,
      settings: { durationMs: 120_000, knockoutTarget: 5 },
      players: [{ playerId: match.guest.playerId, connected: true }]
    });

    const newRoom = await emitSuccess<SessionWelcome>(match.hostClient, 'room:create', { name: 'Ada 2' });
    expect(newRoom.roomCode).not.toBe(match.roomCode);
  });

  it('resolves quick/quick, heavy/quick, and heavy/heavy from monotonic socket input frames', async () => {
    const match = await startMatch();

    await prepare(
      match,
      { x: 580, y: 360 },
      { x: 640, y: 360 },
      { x: 1, y: 0 },
      { x: 0, y: -1 }
    );
    let marker = eventMarker(match.roomCode);
    await quick(match, [
      { client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } },
      { client: match.guestClient, playerId: match.guest.playerId, aim: { x: 0, y: -1 } }
    ]);
    const quickClash = advanceToEvent(match, marker, 'CLASH', 400);
    expect(quickClash.strength).toBe('QUICK');
    expect(eventsAfter(match.roomCode, marker).filter((event) => event.type === 'HIT')).toEqual([]);

    await prepare(
      match,
      { x: 580, y: 360 },
      { x: 640, y: 360 },
      { x: 0, y: 1 },
      { x: 0, y: 1 }
    );
    marker = eventMarker(match.roomCode);
    await charge(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 0, y: 1 } }]);
    advanceBy(match.roomCode, GAME.heavyEnterChargeMs + 40);
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: 0, aimY: 1 } },
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: 0, aimY: 1, quick: true } }
    ]);
    await submitFrames(match, [
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: 0, aimY: 1 } }
    ]);
    const priorityClash = advanceToEvent(match, marker, 'CLASH', 400);
    expect(priorityClash.strength).toBe('HEAVY');
    expect(player(snapshot(match.roomCode), match.host.playerId).action.kind).toBe('HEAVY');
    expect(eventsAfter(match.roomCode, marker).filter((event) => event.type === 'HIT')).toEqual([]);

    await prepare(
      match,
      { x: 580, y: 360 },
      { x: 640, y: 360 },
      { x: 1, y: 0 },
      { x: 0, y: -1 }
    );
    marker = eventMarker(match.roomCode);
    const heavyEntries = [
      { client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } },
      { client: match.guestClient, playerId: match.guest.playerId, aim: { x: 0, y: -1 } }
    ] as const;
    await charge(match, heavyEntries);
    advanceBy(match.roomCode, GAME.heavyEnterChargeMs + 40);
    await releaseHeavy(match, heavyEntries);
    const heavyClash = advanceToEvent(match, marker, 'CLASH', 400);
    expect(heavyClash.strength).toBe('HEAVY');
    expect(player(snapshot(match.roomCode), match.host.playerId).action.phase).toBe('RECOVERY');
    expect(player(snapshot(match.roomCode), match.guest.playerId).action.phase).toBe('RECOVERY');
    expect(eventsAfter(match.roomCode, marker).filter((event) => event.type === 'HIT')).toEqual([]);
  });

  it('resolves attack/pulse, pulse/player, perfect dodge, and charge interruption from real input edges', async () => {
    const match = await startMatch();

    await prepare(match, { x: 500, y: 360 }, { x: 650, y: 360 });
    let marker = eventMarker(match.roomCode);
    await charge(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    advanceBy(match.roomCode, GAME.heavyMaxChargeMs);
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: 1, aimY: 0 } },
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0, quick: true } }
    ]);
    await submitFrames(match, [
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0 } }
    ]);
    const pulseBreak = advanceToEvent(match, marker, 'PULSE_BREAK', 500);
    const pulseSpawn = eventAfter(match.roomCode, marker, 'PULSE_SPAWN');
    expect(pulseSpawn).not.toBeNull();
    expect(pulseBreak.projectileId).toBe(pulseSpawn!.projectileId);
    expect(eventsAfter(match.roomCode, marker).some((event) => event.type === 'HIT' && event.attack === 'NEON_PULSE')).toBe(false);

    await prepare(match, { x: 500, y: 360 }, { x: 720, y: 360 });
    marker = eventMarker(match.roomCode);
    await charge(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    advanceBy(match.roomCode, GAME.heavyMaxChargeMs);
    await releaseHeavy(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    const pulseHit = advanceToEvent(match, marker, 'HIT', 600, (event) => event.attack === 'NEON_PULSE');
    expect(pulseHit).toMatchObject({ attackerId: match.host.playerId, targetId: match.guest.playerId });
    expect(snapshot(match.roomCode).pulses).toEqual([]);

    await prepare(match, { x: 580, y: 360 }, { x: 700, y: 360 });
    marker = eventMarker(match.roomCode);
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: 1, aimY: 0, quick: true } },
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0, dash: true } }
    ]);
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: 1, aimY: 0 } },
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0 } }
    ]);
    const dodge = advanceToEvent(match, marker, 'PERFECT_DODGE', 400);
    expect(dodge).toMatchObject({
      playerId: match.guest.playerId,
      attackerId: match.host.playerId,
      source: 'QUICK_1',
      projectileId: null,
      refundedMs: GAME.perfectDodgeRefundMs
    });

    await prepare(match);
    marker = eventMarker(match.roomCode);
    await charge(match, [{ client: match.guestClient, playerId: match.guest.playerId, aim: { x: -1, y: 0 } }]);
    advanceBy(match.roomCode, GAME.heavyEnterChargeMs + 40);
    expect(player(snapshot(match.roomCode), match.guest.playerId).action.charging).toBe(true);
    await quick(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    advanceToEvent(match, marker, 'HIT', 400, (event) => event.targetId === match.guest.playerId);
    expect(player(snapshot(match.roomCode), match.guest.playerId).action).toMatchObject({
      kind: 'HITSTUN',
      chargeMs: 0,
      charging: false
    });
    expect(eventsAfter(match.roomCode, marker).some((event) => event.type === 'PULSE_SPAWN')).toBe(false);
  });

  it('orders a real pulse hit, credited knockout, and exact 600 ms return monotonically', async () => {
    const match = await startMatch();
    await prepare(match, { x: 500, y: 360 }, { x: 720, y: 360 });
    const marker = eventMarker(match.roomCode);
    await charge(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    advanceBy(match.roomCode, GAME.heavyMaxChargeMs);
    await releaseHeavy(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    const hit = advanceToEvent(match, marker, 'HIT', 600, (event) => event.attack === 'NEON_PULSE');
    expect(hit.resultingOverload).toBeGreaterThan(0);

    harness().placePlayer(match.roomCode, match.guest.playerId, { x: 640, y: 0 }, { x: -1, y: 0 });
    await submitFrames(match, [
      { client: match.guestClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0 } }
    ]);
    const knockout = advanceToEvent(match, hit.eventId, 'KNOCKOUT', 200);
    expect(knockout).toMatchObject({
      attackerId: match.host.playerId,
      targetId: match.guest.playerId,
      scoreAwardedTo: match.host.playerId,
      scores: { [match.host.playerId]: 1, [match.guest.playerId]: 0 }
    });
    const respawn = advanceToEvent(match, knockout.eventId, 'RESPAWN', GAME.knockoutToControlMs + STEP_MS * 2);
    expect((respawn.tick - knockout.tick) * STEP_MS).toBeCloseTo(GAME.knockoutToControlMs, 8);
    const afterReturn = advanceUntil(match.roomCode, (value) => {
      const returned = player(value, match.guest.playerId);
      return returned.respawnRemainingMs === 0 && returned.overload === 0;
    }, 'published respawn state', 100);
    expect(player(afterReturn, match.guest.playerId)).toMatchObject({
      overload: 0,
      respawnRemainingMs: 0,
      stats: { falls: 1 }
    });
    expect(player(afterReturn, match.host.playerId).stats.knockouts).toBe(1);
    const ordered = eventsAfter(match.roomCode, marker).filter((event) =>
      ['PULSE_SPAWN', 'HIT', 'KNOCKOUT', 'RESPAWN'].includes(event.type));
    expect(ordered.map((event) => event.type)).toEqual(['PULSE_SPAWN', 'HIT', 'KNOCKOUT', 'RESPAWN']);
    expect(ordered.map((event) => event.eventId)).toEqual([...ordered].map((event) => event.eventId).sort((left, right) => left - right));
  });

  it('contracts at 75/40 pacing and lets only the next credited sudden-death knockout win', async () => {
    const match = await startMatch();
    const warning = advanceUntil(
      match.roomCode,
      (value) => value.remainingMs <= GAME.contractionWarningRemainingMs,
      '78 second warning boundary',
      GAME.regulationMs - GAME.contractionWarningRemainingMs + 100
    );
    expect(warning.remainingMs).toBeGreaterThan(GAME.contractionStartRemainingMs);
    expect(warning.platformProgress).toBe(0);

    const contracting = advanceUntil(
      match.roomCode,
      (value) => value.remainingMs <= GAME.contractionStartRemainingMs - STEP_MS,
      '75 second contraction start',
      GAME.contractionWarningRemainingMs - GAME.contractionStartRemainingMs + 100
    );
    expect(contracting.platformProgress).toBeGreaterThan(0);

    const minimum = advanceUntil(
      match.roomCode,
      (value) => value.remainingMs <= GAME.contractionMinimumRemainingMs,
      '40 second minimum arena',
      GAME.contractionStartRemainingMs - GAME.contractionMinimumRemainingMs + 100
    );
    expect(minimum.platformProgress).toBe(1);

    const suddenDeath = advanceUntil(
      match.roomCode,
      (value) => value.phase === 'SUDDEN_DEATH',
      'sudden death',
      GAME.contractionMinimumRemainingMs + 100
    );
    expect(suddenDeath).toMatchObject({ phase: 'SUDDEN_DEATH', platformProgress: 1 });
    expect(harness().recentEvents(match.roomCode)).toContainEqual(expect.objectContaining({
      type: 'PHASE',
      phase: 'SUDDEN_DEATH'
    }));

    let marker = eventMarker(match.roomCode);
    harness().placePlayer(match.roomCode, match.guest.playerId, { x: 640, y: 0 }, { x: -1, y: 0 });
    await submitFrames(match, [{ client: match.guestClient, playerId: match.guest.playerId }]);
    const selfFall = advanceToEvent(match, marker, 'KNOCKOUT', 200);
    expect(selfFall.scoreAwardedTo).toBeNull();
    expect(snapshot(match.roomCode)).toMatchObject({ phase: 'SUDDEN_DEATH', scores: { [match.host.playerId]: 0, [match.guest.playerId]: 0 } });
    advanceToEvent(match, selfFall.eventId, 'RESPAWN', GAME.knockoutToControlMs + STEP_MS * 2);
    advanceBy(match.roomCode, GAME.respawnProtectionMs);

    await prepare(match, { x: 580, y: 360 }, { x: 650, y: 360 });
    marker = eventMarker(match.roomCode);
    await quick(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    const hit = advanceToEvent(match, marker, 'HIT', 400, (event) => event.targetId === match.guest.playerId);
    harness().placePlayer(match.roomCode, match.guest.playerId, { x: 640, y: 0 }, { x: -1, y: 0 });
    const credited = advanceToEvent(match, hit.eventId, 'KNOCKOUT', 200);
    const result = advanceToEvent(match, credited.eventId, 'RESULT', 50);
    expect(credited.scoreAwardedTo).toBe(match.host.playerId);
    expect(result).toMatchObject({ winnerPlayerId: match.host.playerId, reason: 'SUDDEN_DEATH' });
  }, 15_000);

  it('preserves identity, chassis, score, statistics, overload, and neutral input across reconnect and rematch', async () => {
    const match = await startMatch();
    await prepare(match);
    const hitMarker = eventMarker(match.roomCode);
    await quick(match, [{ client: match.hostClient, playerId: match.host.playerId, aim: { x: 1, y: 0 } }]);
    const hit = advanceToEvent(match, hitMarker, 'HIT', 400, (event) => event.targetId === match.guest.playerId);
    const beforeDisconnect = snapshot(match.roomCode);
    const guestBefore = player(beforeDisconnect, match.guest.playerId);

    harness().disconnectPlayer(match.roomCode, match.guest.playerId);
    await waitFor(() => server.rooms.debugRoom(match.roomCode)?.connectedCount === 1, 'authoritative disconnect');
    const resumedClient = await client();
    const resumed = await emitSuccess<SessionWelcome>(resumedClient, 'session:resume', {
      roomCode: match.roomCode,
      resumeToken: match.guest.resumeToken
    });
    expect(resumed).toMatchObject({ playerId: match.guest.playerId, resumed: true });
    advanceUntil(match.roomCode, (value) => player(value, match.guest.playerId).respawnRemainingMs === 0, 'reconnect warp', 400);
    const afterResume = snapshot(match.roomCode);
    expect(player(afterResume, match.guest.playerId)).toMatchObject({
      playerId: match.guest.playerId,
      chassis: guestBefore.chassis,
      accent: guestBefore.accent,
      overload: hit.resultingOverload,
      velocity: { x: 0, y: 0 },
      action: { kind: null, charging: false }
    });
    expect(player(afterResume, match.guest.playerId).stats).toEqual(guestBefore.stats);
    expect(afterResume.scores).toEqual(beforeDisconnect.scores);

    const resultState = expectEvent(match.hostClient, 'room:state', (state) => state.phase === 'RESULT');
    for (let knockout = 0; knockout < GAME.targetScore; knockout += 1) {
      const knockoutMarker = eventMarker(match.roomCode);
      harness().forceKnockout(match.roomCode, match.host.playerId, match.guest.playerId);
      const forced = eventAfter(match.roomCode, knockoutMarker, 'KNOCKOUT');
      if (!forced) throw new Error(`Forced result setup knockout ${knockout + 1} did not occur.`);
      if (knockout < GAME.targetScore - 1) {
        advanceToEvent(match, forced.eventId, 'RESPAWN', GAME.knockoutToControlMs + STEP_MS * 2);
      }
    }
    expect((await resultState).players.find((candidate) => candidate.playerId === match.host.playerId)?.stats.knockouts).toBe(GAME.targetScore);
    await emitSuccess<null>(match.hostClient, 'result:ready', { ready: true });
    await emitSuccess<null>(resumedClient, 'result:ready', { ready: true });
    const rematchStarted = expectEvent(resumedClient, 'match:started');
    await emitSuccess<null>(match.hostClient, 'match:start', {});
    expect(await rematchStarted).toMatchObject({
      tick: 0,
      scores: { [match.host.playerId]: 0, [match.guest.playerId]: 0 },
      winnerPlayerId: null,
      resultReason: null
    });

    const rematchSnapshot = advanceUntil(
      match.roomCode,
      (value) => value.phase === 'REGULATION',
      'rematch regulation',
      GAME.countdownMs + 100
    );
    expect(player(rematchSnapshot, match.host.playerId).lastProcessedInputSeq).toBe(-1);
    expect(player(rematchSnapshot, match.guest.playerId).lastProcessedInputSeq).toBe(-1);

    const hostRematchSequence = sequences.get(match.hostClient) ?? 0;
    const guestRematchSequence = sequences.get(resumedClient) ?? 0;
    await submitFrames(match, [
      { client: match.hostClient, playerId: match.host.playerId, overrides: { aimX: 0, aimY: -1, quick: true } },
      { client: resumedClient, playerId: match.guest.playerId, overrides: { aimX: -1, aimY: 0, quick: true } }
    ]);
    const rematchInputsAccepted = snapshot(match.roomCode);
    expect(player(rematchInputsAccepted, match.host.playerId)).toMatchObject({
      lastProcessedInputSeq: hostRematchSequence,
      facing: { x: 0, y: -1 }
    });
    expect(player(rematchInputsAccepted, match.guest.playerId)).toMatchObject({
      lastProcessedInputSeq: guestRematchSequence,
      facing: { x: -1, y: 0 }
    });
  }, 12_000);

  it('accepts at most sixty monotonic inputs per second and silently shapes input bursts', async () => {
    const match = await startMatch();
    const errors: ServerError[] = [];
    match.hostClient.on('server:error', (error) => errors.push(error));
    for (let seq = 100; seq <= 194; seq += 1) match.hostClient.emit('match:input', input(seq));
    const capped = await expectEvent(match.hostClient, 'match:snapshot',
      (value) => player(value, match.host.playerId).lastProcessedInputSeq === 159);
    expect(player(capped, match.host.playerId).lastProcessedInputSeq).toBe(159);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors.filter((error) => error.code === 'RATE_LIMITED')).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    match.hostClient.emit('match:input', input(200));
    match.hostClient.emit('match:input', input(199, { moveX: -1 }));
    const monotonic = await expectEvent(match.hostClient, 'match:snapshot',
      (value) => player(value, match.host.playerId).lastProcessedInputSeq === 200);
    expect(player(monotonic, match.host.playerId).lastProcessedInputSeq).toBe(200);
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
});
