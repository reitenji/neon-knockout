import { describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Ack, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AcknowledgedEvent = 'room:create' | 'room:join' | 'lobby:ready' | 'match:start';

async function connectClient(origin: string): Promise<GameClient> {
  const socket: GameClient = io(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting RTT test client.')), 1_500);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function emitAck<T>(socket: GameClient, event: AcknowledgedEvent, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), 1_500);
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

function welcome(acknowledgement: Ack<SessionWelcome>): SessionWelcome {
  if (!acknowledgement.ok) throw new Error(acknowledgement.error.code);
  return acknowledgement.data;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2_500): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Socket.IO RTT probes', () => {
  it('stays independent of slow snapshot acknowledgements and continues while the match is paused', async () => {
    const server = createGameServer({
      host: '127.0.0.1',
      port: 0,
      clientDirectory: false,
      enableTestHarness: true
    });
    let hostClient: GameClient | null = null;
    let guestClient: GameClient | null = null;
    let hostProbeCount = 0;

    try {
      const address = await server.start();
      hostClient = await connectClient(address.origin);
      guestClient = await connectClient(address.origin);
      hostClient.on('network:probe', (probe, acknowledge) => {
        hostProbeCount += 1;
        acknowledge({ nonce: probe.nonce });
      });
      guestClient.on('network:probe', (probe, acknowledge) => acknowledge({ nonce: probe.nonce }));
      hostClient.on('match:snapshot', (_publication, acknowledge) => {
        setTimeout(acknowledge, 250);
      });
      guestClient.on('match:snapshot', (_publication, acknowledge) => acknowledge());

      const host = welcome(await emitAck<SessionWelcome>(hostClient, 'room:create', { name: 'Ada' }));
      welcome(await emitAck<SessionWelcome>(guestClient, 'room:join', {
        name: 'Linus',
        roomCode: host.roomCode
      }));
      expect(await emitAck<null>(hostClient, 'lobby:ready', { ready: true })).toEqual({ ok: true, data: null });
      expect(await emitAck<null>(guestClient, 'lobby:ready', { ready: true })).toEqual({ ok: true, data: null });
      expect(await emitAck<null>(hostClient, 'match:start', {})).toEqual({ ok: true, data: null });

      await waitFor(
        () => server.testHarness?.matchSnapshot(host.roomCode)?.network[host.playerId]?.currentMs !== null,
        'a lightweight Socket RTT sample'
      );
      expect(server.testHarness?.matchSnapshot(host.roomCode)?.network[host.playerId]?.currentMs)
        .toBeLessThan(150);

      guestClient.disconnect();
      await waitFor(
        () => server.testHarness?.matchSnapshot(host.roomCode)?.phase === 'PAUSED',
        'the reconnect pause'
      );
      const probesBeforePauseSample = hostProbeCount;
      await waitFor(() => hostProbeCount > probesBeforePauseSample, 'an RTT probe during pause');
      expect(server.testHarness?.matchSnapshot(host.roomCode)?.network[host.playerId]?.currentMs)
        .not.toBeNull();
    } finally {
      hostClient?.disconnect();
      guestClient?.disconnect();
      await server.stop();
    }
  });
});
