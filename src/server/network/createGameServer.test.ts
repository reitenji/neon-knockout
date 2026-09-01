import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME } from '../../shared/constants.js';
import type { Ack, SessionWelcome } from '../../shared/model.js';
import { RoomManager, type RoomPublication } from '../rooms/roomManager.js';
import { createGameServer } from './createGameServer.js';
import { registerSocketHandlers, type GameIo, type GameSocket } from './socketHandlers.js';

describe('createGameServer scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules authoritative room advancement at the shared tick rate', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });

    try {
      await server.start();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000 / GAME.tickRate);
    } finally {
      await server.stop();
    }
  });

  it('keeps the combat scripting surface absent unless the in-process test harness is explicitly enabled', () => {
    const productionServer = createGameServer({ clientDirectory: false });
    const testServer = createGameServer({ clientDirectory: false, enableTestHarness: true });

    expect(productionServer.testHarness).toBeNull();
    expect(testServer.testHarness?.runCombatScript).toBeTypeOf('function');
  });
});

describe('socket latency scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('publishes a capped current RTT when an active probe times out and keeps sampling until disconnect', () => {
    vi.useFakeTimers();
    const publications: RoomPublication[] = [];
    let randomByte = 0;
    const rooms = new RoomManager({
      now: () => 0,
      randomBytes: (size) => new Uint8Array(size).fill(randomByte++),
      publish: (publication) => publications.push(publication)
    });
    let onConnection: ((socket: GameSocket) => void) | undefined;
    const io = {
      on: (_event: string, listener: (socket: GameSocket) => void): void => {
        onConnection = listener;
      }
    } as unknown as GameIo;
    const socketListeners = new Map<string, (...args: unknown[]) => void>();
    let probeCount = 0;
    const socket = {
      id: 'host-socket',
      conn: {
        transport: { name: 'websocket' },
        on: () => undefined
      },
      emit: (event: string, ...args: unknown[]): boolean => {
        if (event === 'network:probe') {
          probeCount += 1;
          if (probeCount === 1) (args[0] as () => void)();
        }
        return true;
      },
      join: async () => undefined,
      leave: async () => undefined,
      on: (event: string, listener: (...args: unknown[]) => void): void => {
        socketListeners.set(event, listener);
      }
    } as unknown as GameSocket;

    registerSocketHandlers({
      io,
      rooms,
      now: () => 0,
      logger: { error: vi.fn() },
      onSession: () => undefined,
      onLeave: () => undefined,
      onDisconnect: () => undefined
    });
    if (!onConnection) throw new Error('Socket connection handler was not registered.');
    onConnection(socket);

    const createRoom = socketListeners.get('room:create') as (
      payload: { name: string },
      acknowledge: (acknowledgement: Ack<SessionWelcome>) => void
    ) => void;
    let host: SessionWelcome | undefined;
    createRoom({ name: 'Ada' }, (acknowledgement) => {
      if (!acknowledgement.ok) throw new Error(acknowledgement.error.code);
      host = acknowledgement.data;
    });
    if (!host) throw new Error('Host session was not established.');
    const establishedHost = host;
    rooms.joinRoom('guest-socket', establishedHost.roomCode, 'Linus');
    rooms.setReady('host-socket', true);
    rooms.setReady('guest-socket', true);
    rooms.startMatch('host-socket');

    const currentPing = (): number | null => {
      rooms.advance(20);
      const publication = [...publications].reverse().find(
        (candidate): candidate is Extract<RoomPublication, { type: 'MATCH_SNAPSHOT' }> =>
          candidate.type === 'MATCH_SNAPSHOT'
      );
      if (!publication) throw new Error('Match snapshot was not published.');
      return publication.snapshot.network[establishedHost.playerId]?.currentMs ?? null;
    };

    vi.advanceTimersByTime(200);
    expect(probeCount).toBe(1);
    expect(currentPing()).toBe(0);

    vi.advanceTimersByTime(GAME.maxPingMs);
    expect(probeCount).toBe(2);
    vi.advanceTimersByTime(GAME.maxPingMs);
    expect(currentPing()).toBe(GAME.maxPingMs);

    vi.advanceTimersByTime(GAME.maxPingMs);
    expect(probeCount).toBe(3);
    socketListeners.get('disconnect')?.();
    vi.advanceTimersByTime(GAME.maxPingMs * 2);
    expect(probeCount).toBe(3);
  });
});
