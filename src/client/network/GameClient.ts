import { io, type Socket } from 'socket.io-client';
import type { Ack, Chassis, GameEvent, InputFrame, MatchSnapshot, RoomState, ServerError, SessionWelcome } from '../../shared/model.js';
import type { RoomSettings } from '../../shared/roomSettings.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js';

export type GameClientConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type GameClientEvents = {
  connection: (state: GameClientConnectionState) => void;
  'session:welcome': (welcome: SessionWelcome) => void;
  'room:state': (state: RoomState) => void;
  'match:started': (snapshot: MatchSnapshot) => void;
  'match:snapshot': (snapshot: MatchSnapshot) => void;
  'match:event': (event: GameEvent) => void;
  'server:error': (error: ServerError) => void;
};

export interface GameClient {
  connect(): void;
  disconnect(): void;
  getConnectionState(): GameClientConnectionState;
  subscribe<E extends keyof GameClientEvents>(event: E, listener: GameClientEvents[E]): () => void;
  createRoom(name: string): Promise<Ack<SessionWelcome>>;
  joinRoom(name: string, roomCode: string): Promise<Ack<SessionWelcome>>;
  resumeSession(roomCode: string, resumeToken: string): Promise<Ack<SessionWelcome>>;
  setChassis(chassis: Chassis): Promise<Ack<null>>;
  setReady(ready: boolean): Promise<Ack<null>>;
  setRoomSettings(settings: RoomSettings): Promise<Ack<null>>;
  leaveRoom(): Promise<Ack<null>>;
  startMatch(): Promise<Ack<null>>;
  sendInput(input: InputFrame): void;
  setResultReady(ready: boolean): Promise<Ack<null>>;
  returnToLobby(): Promise<Ack<null>>;
}

type ListenerSets = { [K in keyof GameClientEvents]: Set<GameClientEvents[K]> };
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type SocketGameClientOptions = Readonly<{
  origin?: string;
  acknowledgementTimeoutMs?: number;
}>;

const ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;

const ACK_TIMEOUT_ERROR: ServerError = {
  code: 'ACK_TIMEOUT',
  message: 'Sunucu yanıt vermedi.',
  recoverable: true
};

function createListenerSets(): ListenerSets {
  return {
    connection: new Set(),
    'session:welcome': new Set(),
    'room:state': new Set(),
    'match:started': new Set(),
    'match:snapshot': new Set(),
    'match:event': new Set(),
    'server:error': new Set()
  };
}

export function createSocketGameClient(options: SocketGameClientOptions = {}): GameClient {
  const origin = options.origin ?? window.location.origin;
  const timeoutMs = options.acknowledgementTimeoutMs ?? ACKNOWLEDGEMENT_TIMEOUT_MS;
  const socket: GameSocket = io(origin, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    transports: ['websocket']
  });
  const listeners = createListenerSets();
  let connectionState: GameClientConnectionState = 'idle';
  let hasConnected = false;

  const publish = <E extends keyof GameClientEvents>(event: E, ...args: Parameters<GameClientEvents[E]>): void => {
    for (const listener of listeners[event]) {
      (listener as (...eventArgs: Parameters<GameClientEvents[E]>) => void)(...args);
    }
  };

  const setConnectionState = (next: GameClientConnectionState): void => {
    if (next === connectionState) return;
    connectionState = next;
    publish('connection', next);
  };

  const withAckTimeout = <T>(send: (acknowledge: (acknowledgement: Ack<T>) => void) => void): Promise<Ack<T>> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (acknowledgement: Ack<T>): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(acknowledgement);
      };
      const timer = window.setTimeout(() => finish({ ok: false, error: ACK_TIMEOUT_ERROR }), timeoutMs);
      send(finish);
    });

  socket.on('connect', () => {
    hasConnected = true;
    setConnectionState('connected');
  });
  socket.io.on('reconnect_attempt', () => setConnectionState(hasConnected ? 'reconnecting' : 'connecting'));
  socket.on('connect_error', () => setConnectionState(hasConnected ? 'reconnecting' : 'disconnected'));
  socket.on('disconnect', () => setConnectionState(socket.active ? 'reconnecting' : 'disconnected'));
  socket.on('session:welcome', (welcome) => publish('session:welcome', welcome));
  socket.on('room:state', (state) => publish('room:state', state));
  socket.on('match:started', (snapshot) => publish('match:started', snapshot));
  socket.on('match:snapshot', (snapshot) => publish('match:snapshot', snapshot));
  socket.on('match:event', (event) => publish('match:event', event));
  socket.on('network:probe', (acknowledge) => acknowledge());
  socket.on('server:error', (error) => publish('server:error', error));

  return {
    connect(): void {
      if (socket.connected || socket.active) return;
      setConnectionState(hasConnected ? 'reconnecting' : 'connecting');
      socket.connect();
    },
    disconnect(): void {
      socket.disconnect();
      setConnectionState('disconnected');
    },
    getConnectionState(): GameClientConnectionState {
      return connectionState;
    },
    subscribe<E extends keyof GameClientEvents>(event: E, listener: GameClientEvents[E]): () => void {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    createRoom(name: string): Promise<Ack<SessionWelcome>> {
      return withAckTimeout((acknowledge) => socket.emit('room:create', { name }, acknowledge));
    },
    joinRoom(name: string, roomCode: string): Promise<Ack<SessionWelcome>> {
      return withAckTimeout((acknowledge) => socket.emit('room:join', { name, roomCode }, acknowledge));
    },
    resumeSession(roomCode: string, resumeToken: string): Promise<Ack<SessionWelcome>> {
      return withAckTimeout((acknowledge) => socket.emit('session:resume', { roomCode, resumeToken }, acknowledge));
    },
    setChassis(chassis: Chassis): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('lobby:chassis', { chassis }, acknowledge));
    },
    setReady(ready: boolean): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('lobby:ready', { ready }, acknowledge));
    },
    setRoomSettings(settings: RoomSettings): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('lobby:settings', settings, acknowledge));
    },
    leaveRoom(): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('room:leave', {}, acknowledge));
    },
    startMatch(): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('match:start', {}, acknowledge));
    },
    sendInput(input: InputFrame): void {
      socket.emit('match:input', input);
    },
    setResultReady(ready: boolean): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('result:ready', { ready }, acknowledge));
    },
    returnToLobby(): Promise<Ack<null>> {
      return withAckTimeout((acknowledge) => socket.emit('result:lobby', {}, acknowledge));
    }
  };
}
