import { describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Ack, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { createGameServer } from '../../src/server/network/createGameServer.js';

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type SessionEvent = 'room:create' | 'room:join' | 'session:resume';

async function healthStatus(origin: string): Promise<number> {
  return fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) })
    .then((response) => response.status)
    .catch(() => 0);
}

async function connectClient(origin: string): Promise<GameClient> {
  const socket: GameClient = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting lifecycle client')), 1_500);
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

function emitAck<T>(socket: GameClient, event: SessionEvent, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1_500);
    const emit = socket.emit.bind(socket) as (
      eventName: string,
      eventPayload: unknown,
      acknowledge: (ack: Ack<T>) => void
    ) => void;
    emit(event, payload, (acknowledgement) => {
      clearTimeout(timer);
      resolve(acknowledgement);
    });
  });
}

function expectWelcome(acknowledgement: Ack<SessionWelcome>): SessionWelcome {
  if (!acknowledgement.ok) throw new Error(acknowledgement.error.code);
  return acknowledgement.data;
}

describe('GameServer lifecycle', () => {
  it('discovers the current LAN address on every runtime network request', async () => {
    let currentAddress = '192.168.68.51';
    const server = createGameServer({
      host: '127.0.0.1',
      port: 0,
      clientDirectory: false,
      networkInterfaces: () => ({
        en0: [{ address: currentAddress, family: 'IPv4', internal: false }],
        utun4: [{ address: '10.8.0.2', family: 'IPv4', internal: false }]
      })
    });

    try {
      const address = await server.start();
      const first = await fetch(`${address.origin}/api/runtime/network`).then((response) => response.json());

      expect(first).toEqual({
        port: address.port,
        localUrl: `http://localhost:${address.port}`,
        lanAddresses: [{
          interfaceName: 'en0',
          address: '192.168.68.51',
          url: `http://192.168.68.51:${address.port}`
        }]
      });

      currentAddress = '192.168.68.52';
      const second = await fetch(`${address.origin}/api/runtime/network`).then((response) => response.json());
      expect(second).toEqual({
        port: address.port,
        localUrl: `http://localhost:${address.port}`,
        lanAddresses: [{
          interfaceName: 'en0',
          address: '192.168.68.52',
          url: `http://192.168.68.52:${address.port}`
        }]
      });
    } finally {
      await server.stop();
    }
  });

  it('coalesces concurrent starts onto one listener and one address', async () => {
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    try {
      const firstStart = server.start();
      const secondStart = server.start();
      expect(secondStart).toBe(firstStart);

      const [first, second] = await Promise.all([firstStart, secondStart]);

      expect(second).toEqual(first);
      expect(await healthStatus(first.origin)).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('lets stop join an in-flight start, closes the listener, and permits a later start', async () => {
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    try {
      const starting = server.start();
      const stopping = server.stop();
      const firstAddress = await starting;
      await stopping;

      expect(await healthStatus(firstAddress.origin)).toBe(0);

      const restarted = await server.start();
      expect(await healthStatus(restarted.origin)).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('coalesces starts requested during stop onto one post-stop restart', async () => {
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    try {
      const initialStart = server.start();
      const stopping = server.stop();
      const firstRestart = server.start();
      const secondRestart = server.start();

      expect(firstRestart).toBe(secondRestart);
      expect(firstRestart).not.toBe(initialStart);

      await stopping;
      const restarted = await firstRestart;
      expect(await healthStatus(restarted.origin)).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('restarts with fresh room state and a working Socket.IO boundary', async () => {
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    let firstClient: GameClient | null = null;
    let restartedClient: GameClient | null = null;
    try {
      const firstAddress = await server.start();
      firstClient = await connectClient(firstAddress.origin);
      const oldRoom = expectWelcome(await emitAck<SessionWelcome>(firstClient, 'room:create', { name: 'Ada' }));

      await server.stop();
      const restarted = await server.start();
      expect(await fetch(`${restarted.origin}/health`).then((response) => response.json())).toMatchObject({ rooms: 0 });

      restartedClient = await connectClient(restarted.origin);
      expect(await emitAck<SessionWelcome>(restartedClient, 'room:join', {
        name: 'Linus',
        roomCode: oldRoom.roomCode
      })).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
      expect(await emitAck<SessionWelcome>(restartedClient, 'session:resume', {
        roomCode: oldRoom.roomCode,
        resumeToken: oldRoom.resumeToken
      })).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });

      const newRoom = expectWelcome(await emitAck<SessionWelcome>(restartedClient, 'room:create', { name: 'Grace' }));
      expect(newRoom.roomCode).toHaveLength(4);
      expect(await fetch(`${restarted.origin}/health`).then((response) => response.json())).toMatchObject({ rooms: 1 });
    } finally {
      firstClient?.disconnect();
      restartedClient?.disconnect();
      await server.stop();
    }
  });
});
