import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME } from '../../shared/constants.js';
import type { Ack, SessionWelcome } from '../../shared/model.js';
import { RoomManager } from '../rooms/roomManager.js';
import { createGameServer } from './createGameServer.js';
import { GameplayTransportHub } from './gameplayTransport/GameplayTransportHub.js';
import type { MatchInputIngress } from './matchInputIngress.js';
import { registerSocketHandlers, type GameIo, type GameSocket } from './socketHandlers.js';

function inertTransportHub(): GameplayTransportHub {
  return new GameplayTransportHub({
    peerFactory: () => { throw new Error('No peer expected in this unit test.'); },
    udpPortRange: [54100, 54131]
  });
}

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
    expect(testServer.testHarness?.transportMode).toBeTypeOf('function');
    expect(testServer.testHarness?.dropWebRtc).toBeTypeOf('function');
    expect(testServer.testHarness?.acceptedInputs).toBeTypeOf('function');
    expect(testServer.testHarness?.transportGeneration).toBeTypeOf('function');
  });
});

describe('socket session ingress', () => {
  it('passes each established session its authoritative input ingress', () => {
    const rooms = new RoomManager({
      now: () => 0,
      randomBytes: (size) => new Uint8Array(size).fill(size),
      publish: () => undefined
    });
    let onConnection: ((socket: GameSocket) => void) | undefined;
    const io = {
      on: (_event: string, listener: (socket: GameSocket) => void): void => {
        onConnection = listener;
      }
    } as unknown as GameIo;
    const socketListeners = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      id: 'host-socket',
      conn: { transport: { name: 'websocket' }, on: () => undefined },
      emit: () => true,
      join: async () => undefined,
      leave: async () => undefined,
      on: (event: string, listener: (...args: unknown[]) => void): void => {
        socketListeners.set(event, listener);
      }
    } as unknown as GameSocket;
    let sessionIngress: MatchInputIngress | undefined;

    registerSocketHandlers({
      io,
      rooms,
      now: () => 0,
      logger: { error: vi.fn() },
      transportHub: inertTransportHub(),
      onSession: (_socket, _welcome, inputIngress) => { sessionIngress = inputIngress; },
      onLeave: () => undefined,
      onDisconnect: () => undefined
    });
    if (!onConnection) throw new Error('Socket connection handler was not registered.');
    onConnection(socket);
    const createRoom = socketListeners.get('room:create') as (
      payload: { name: string },
      acknowledge: (acknowledgement: Ack<SessionWelcome>) => void
    ) => void;
    createRoom({ name: 'Ada' }, () => undefined);

    expect(sessionIngress).toMatchObject({ accept: expect.any(Function), reset: expect.any(Function) });
  });
});
