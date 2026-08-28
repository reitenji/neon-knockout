import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputFrame, RoomState } from '../../shared/model.js';

const socketHarness = vi.hoisted(() => {
  type Handler = (...args: never[]) => void;
  const handlers = new Map<string, Set<Handler>>();
  const managerHandlers = new Map<string, Set<Handler>>();

  const addHandler = (target: Map<string, Set<Handler>>, event: string, handler: Handler): void => {
    const listeners = target.get(event) ?? new Set<Handler>();
    listeners.add(handler);
    target.set(event, listeners);
  };

  const socket = {
    connected: false,
    active: false,
    on: vi.fn((event: string, handler: Handler) => addHandler(handlers, event, handler)),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: Handler) => addHandler(managerHandlers, event, handler))
    }
  };

  return {
    socket,
    io: vi.fn(() => socket),
    trigger(event: string, ...args: unknown[]): void {
      for (const listener of handlers.get(event) ?? []) listener(...(args as never[]));
    },
    reset(): void {
      handlers.clear();
      managerHandlers.clear();
      socket.connected = false;
      socket.active = false;
      socket.on.mockClear();
      socket.emit.mockReset();
      socket.connect.mockClear();
      socket.disconnect.mockClear();
      socket.io.on.mockClear();
      this.io.mockClear();
    }
  };
});

vi.mock('socket.io-client', () => ({ io: socketHarness.io }));

import { createSocketGameClient } from './GameClient.js';

function roomState(): RoomState {
  return {
    roomCode: 'AB2Z',
    phase: 'LOBBY',
    hostPlayerId: 'player-1',
    players: []
  };
}

describe('createSocketGameClient', () => {
  beforeEach(() => socketHarness.reset());

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates one same-origin WebSocket client and cleans external subscriptions', () => {
    const client = createSocketGameClient();
    const listener = vi.fn();
    const unsubscribe = client.subscribe('room:state', listener);

    expect(socketHarness.io).toHaveBeenCalledOnce();
    expect(socketHarness.io).toHaveBeenCalledWith(window.location.origin, expect.objectContaining({ transports: ['websocket'] }));

    socketHarness.trigger('room:state', roomState());
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    socketHarness.trigger('room:state', roomState());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns a typed recoverable failure when an acknowledgement times out', async () => {
    vi.useFakeTimers();
    const client = createSocketGameClient({ acknowledgementTimeoutMs: 25 });

    const acknowledgement = client.createRoom('Ada');
    await vi.advanceTimersByTimeAsync(25);

    await expect(acknowledgement).resolves.toEqual({
      ok: false,
      error: {
        code: 'ACK_TIMEOUT',
        message: 'Sunucu yanıt vermedi.',
        recoverable: true
      }
    });
  });

  it('sends match input fire-and-forget without an acknowledgement callback', () => {
    const client = createSocketGameClient();
    const input: InputFrame = {
      seq: 4,
      up: false,
      down: false,
      left: false,
      right: true,
      dash: true
    };

    client.sendInput(input);

    expect(socketHarness.socket.emit).toHaveBeenCalledWith('match:input', input);
    expect(socketHarness.socket.emit.mock.calls.at(-1)).toHaveLength(2);
  });
});
