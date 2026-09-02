// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { MatchSnapshotPublication } from '../../src/shared/gameplayTransport.js';
import type { InputFrame, MatchSnapshot, ServerError, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer, type GameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEvent = Exclude<keyof ClientToServerEvents, 'match:input'>;

const CLIENT_COUNT = 8;
const INPUT_DURATION_MS = 10_000;
const ACK_TIMEOUT_MS = 2_000;
const EVENT_TIMEOUT_MS = 15_000;

function emitAck<T>(socket: GameClient, event: AckEvent, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), ACK_TIMEOUT_MS);
    const emit = socket.emit.bind(socket) as (
      eventName: string, eventPayload: unknown, acknowledge: (ack: { ok: true; data: T } | { ok: false; error: ServerError }) => void
    ) => void;
    emit(event, payload, (acknowledgement) => {
      clearTimeout(timer);
      if (acknowledgement.ok) resolve(acknowledgement.data);
      else reject(new Error(`${acknowledgement.error.code}: ${acknowledgement.error.message}`));
    });
  });
}

function waitForSnapshot(socket: GameClient, debug: () => unknown): Promise<MatchSnapshot> {
  return new Promise((resolve, reject) => {
    const listener = (publication: MatchSnapshotPublication): void => {
      const { snapshot } = publication;
      if (snapshot.phase !== 'REGULATION') return;
      clearTimeout(timer);
      socket.off('match:snapshot', listener);
      resolve(snapshot);
    };
    const timer = setTimeout(() => {
      socket.off('match:snapshot', listener);
      reject(new Error(`Timed out waiting for regulation snapshot: ${JSON.stringify(debug())}`));
    }, EVENT_TIMEOUT_MS + 2_000);
    socket.on('match:snapshot', listener);
  });
}

function waitForCountdown(socket: GameClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (room: { phase: string }): void => {
      if (room.phase !== 'COUNTDOWN') return;
      clearTimeout(timer);
      socket.off('room:state', listener);
      resolve();
    };
    const timer = setTimeout(() => {
      socket.off('room:state', listener);
      reject(new Error('Timed out waiting for countdown room state'));
    }, EVENT_TIMEOUT_MS);
    socket.on('room:state', listener);
  });
}

async function connect(origin: string): Promise<GameClient> {
  const client: GameClient = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting WebSocket client')), ACK_TIMEOUT_MS);
    client.once('connect', () => { clearTimeout(timer); resolve(); });
    client.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  return client;
}

function input(seq: number, clientIndex: number): InputFrame {
  const cycle = seq % 240;
  const cardinal = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 }
  ][clientIndex % 4]!;
  const steered = { x: -cardinal.y, y: cardinal.x };
  const movementActive = cycle < 45 || (cycle >= 120 && cycle < 160);
  const charging = cycle >= 60 && cycle < 104;
  const aim = charging && cycle >= 82 ? steered : cardinal;
  return {
    seq,
    moveX: movementActive ? cardinal.x : 0,
    moveY: movementActive ? cardinal.y : 0,
    aimX: aim.x,
    aimY: aim.y,
    quick: cycle === 4 || cycle === 30,
    heavy: charging,
    dash: cycle === 124
  };
}

describe('eight-client delivery load', () => {
  let server: GameServer | null = null;
  const clients: GameClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server?.stop();
    server = null;
  });

  it('keeps eight websocket clients receiving snapshots through ten seconds of legal sixty-hertz input', async () => {
    const serverErrors: string[] = [];
    server = createGameServer({
      host: '127.0.0.1',
      port: 0,
      enableTestHarness: true,
      clientDirectory: false,
      logger: { error: (...values: unknown[]) => { serverErrors.push(values.map(String).join(' ')); } }
    });
    const { origin } = await server.start();
    const snapshotCounts = new Array<number>(CLIENT_COUNT).fill(0);
    const errors: ServerError[] = [];

    for (let index = 0; index < CLIENT_COUNT; index += 1) {
      const client = await connect(origin);
      clients.push(client);
      client.on('match:snapshot', () => { snapshotCounts[index] += 1; });
      client.on('server:error', (error) => errors.push(error));
    }

    const host = await emitAck<SessionWelcome>(clients[0]!, 'room:create', { name: 'Player 1' });
    const welcomes = [host];
    for (let index = 1; index < CLIENT_COUNT; index += 1) {
      welcomes.push(await emitAck<SessionWelcome>(clients[index]!, 'room:join', { name: `Player ${index + 1}`, roomCode: host.roomCode }));
    }
    await Promise.all(clients.map((client, index) => emitAck<null>(client, 'lobby:chassis', {
      chassis: ['RIFT', 'BASTION', 'PULSE', 'WRAITH'][index % 4]
    })));
    await Promise.all(clients.map((client) => emitAck<null>(client, 'lobby:ready', { ready: true })));
    expect(server.rooms.debugRoom(host.roomCode)).toMatchObject({ connectedCount: CLIENT_COUNT, reservedCount: 0 });
    const countdown = waitForCountdown(clients[0]!);
    const regulation = waitForSnapshot(clients[0]!, () => server?.rooms.debugRoom(host.roomCode));
    await emitAck<null>(clients[0]!, 'match:start', {});
    await countdown;
    await regulation;
    expect(welcomes.map((welcome) => server?.testHarness?.transportMode(welcome.playerId)))
      .toEqual(new Array(CLIENT_COUNT).fill('websocket'));

    const startedAt = performance.now();
    let sequence = 0;
    while (performance.now() - startedAt < INPUT_DURATION_MS) {
      for (let index = 0; index < clients.length; index += 1) {
        clients[index]!.emit('match:input', input(sequence, index));
      }
      sequence += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_000 / 60));
    }

    const health = await fetch(`${origin}/health`).then((response) => response.json() as Promise<{ status: string; rooms: number }>);
    expect(health).toEqual(expect.objectContaining({ status: 'ok', rooms: 1 }));
    expect(server.testHarness?.matchSnapshot(host.roomCode)?.players).toHaveLength(CLIENT_COUNT);
    expect(welcomes).toHaveLength(CLIENT_COUNT);
    expect(errors).toEqual([]);
    expect(serverErrors).toEqual([]);
    expect(snapshotCounts).toSatisfy((counts: number[]) => counts.every((count) => count >= 500));
    console.info(`LOAD_SNAPSHOT_COUNTS ${JSON.stringify(snapshotCounts)}`);

    const runningServer = server;
    for (const client of clients.splice(0)) client.disconnect();
    await runningServer.stop();
    expect(runningServer.testHarness?.matchSnapshot(host.roomCode)).toBeNull();
    expect(runningServer.testHarness?.recentEvents(host.roomCode)).toEqual([]);
    server = null;
  }, 35_000);
});
