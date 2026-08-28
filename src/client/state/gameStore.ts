import type { MatchSnapshot, RoomPlayer, RoomState, ServerError, SessionWelcome, Team } from '../../shared/model.js';
import { normalizePlayerName, normalizeRoomCode } from '../../shared/names.js';
import type { GameClient, GameClientConnectionState } from '../network/GameClient.js';

export type GameScreen = 'LANDING' | 'LOBBY' | 'MATCH' | 'RESULT';
export type PendingAction = 'create-room' | 'join-room' | 'resume' | 'team' | 'ready' | 'start' | null;
export type ErrorAction = Exclude<PendingAction, null> | 'server' | null;
export type CopyFeedback = 'idle' | 'copied' | 'failed';

export type Toast = Readonly<{
  id: number;
  message: string;
  tone: 'info' | 'warning' | 'error';
}>;

export type ClientSession = Readonly<{
  playerId: string;
  roomCode: string;
  resumeToken: string;
}>;

export type ClientState = Readonly<{
  screen: GameScreen;
  connectionState: GameClientConnectionState;
  room: RoomState | null;
  match: MatchSnapshot | null;
  session: ClientSession | null;
  pendingAction: PendingAction;
  lastError: ServerError | null;
  errorAction: ErrorAction;
  copyFeedback: CopyFeedback;
  toasts: readonly Toast[];
  soundMuted: boolean;
}>;

export interface GameStore {
  getSnapshot(): ClientState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
  actions: {
    connect(): void;
    createRoom(name: string): Promise<void>;
    joinRoom(name: string, code: string): Promise<void>;
    setTeam(team: Team): Promise<void>;
    setReady(ready: boolean): Promise<void>;
    startMatch(): Promise<void>;
    copyRoomCode(): Promise<void>;
    toggleSound(): void;
    dismissToast(id: number): void;
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ClipboardLike = Pick<Clipboard, 'writeText'>;

type GameStoreOptions = Readonly<{
  client: GameClient;
  storage: StorageLike;
  clipboard: ClipboardLike;
}>;

const LAST_ROOM_KEY = 'neon-relay:last-room';
const SOUND_KEY = 'neon-relay:muted';

function resumeKey(roomCode: string): string {
  return `neon-relay:${roomCode}:resume`;
}

function screenForRoom(room: RoomState | null): GameScreen {
  if (!room) return 'LANDING';
  if (room.phase === 'LOBBY') return 'LOBBY';
  if (room.phase === 'RESULT') return 'RESULT';
  return 'MATCH';
}

function actionError(action: ErrorAction, error: ServerError, current: ClientState): ClientState {
  return {
    ...current,
    pendingAction: null,
    lastError: error,
    errorAction: action
  };
}

function invalidNameError(): ServerError {
  return {
    code: 'INVALID_NAME',
    message: 'Oyuncu adı 2–16 görünür karakter olmalıdır.',
    recoverable: true
  };
}

function invalidRoomCodeError(): ServerError {
  return {
    code: 'INVALID_ROOM_CODE',
    message: 'Oda kodu geçersiz.',
    recoverable: true
  };
}

function normalizeNameOrNull(name: string): string | null {
  try {
    return normalizePlayerName(name);
  } catch {
    return null;
  }
}

function normalizeCodeOrNull(code: string): string | null {
  try {
    return normalizeRoomCode(code);
  } catch {
    return null;
  }
}

export function createGameStore({ client, storage, clipboard }: GameStoreOptions): GameStore {
  const listeners = new Set<() => void>();
  const unsubscribeClient: Array<() => void> = [];
  let disposed = false;
  let resumeAttemptedForConnection = false;
  let toastId = 0;
  let state: ClientState = {
    screen: 'LANDING',
    connectionState: client.getConnectionState(),
    room: null,
    match: null,
    session: null,
    pendingAction: null,
    lastError: null,
    errorAction: null,
    copyFeedback: 'idle',
    toasts: [],
    soundMuted: storage.getItem(SOUND_KEY) === 'true'
  };

  const emit = (): void => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };

  const replace = (next: ClientState): void => {
    if (disposed || Object.is(next, state)) return;
    state = next;
    emit();
  };

  const patch = (recipe: (current: ClientState) => ClientState): void => replace(recipe(state));

  const persistWelcome = (welcome: SessionWelcome): void => {
    const session: ClientSession = {
      playerId: welcome.playerId,
      roomCode: welcome.roomCode,
      resumeToken: welcome.resumeToken
    };
    storage.setItem(resumeKey(welcome.roomCode), welcome.resumeToken);
    storage.setItem(LAST_ROOM_KEY, welcome.roomCode);
    patch((current) => ({ ...current, session, lastError: null, errorAction: null }));
  };

  const forgetRoom = (roomCode: string): void => {
    storage.removeItem(resumeKey(roomCode));
    if (storage.getItem(LAST_ROOM_KEY) === roomCode) storage.removeItem(LAST_ROOM_KEY);
  };

  const setFailure = (action: ErrorAction, error: ServerError): void => {
    patch((current) => actionError(action, error, current));
  };

  const setUnexpectedFailure = (action: ErrorAction): void => {
    setFailure(action, {
      code: 'CLIENT_ERROR',
      message: 'Beklenmeyen bir istemci hatası oluştu.',
      recoverable: true
    });
  };

  const beginAction = (action: Exclude<PendingAction, null>): boolean => {
    if (state.pendingAction !== null) return false;
    patch((current) => ({
      ...current,
      pendingAction: action,
      lastError: null,
      errorAction: null,
      copyFeedback: action === 'create-room' || action === 'join-room' ? 'idle' : current.copyFeedback
    }));
    return true;
  };

  const attemptResume = async (): Promise<void> => {
    if (resumeAttemptedForConnection || state.pendingAction !== null) return;
    const roomCode = storage.getItem(LAST_ROOM_KEY);
    const resumeToken = roomCode ? storage.getItem(resumeKey(roomCode)) : null;
    if (!roomCode || !resumeToken) return;

    resumeAttemptedForConnection = true;
    patch((current) => ({ ...current, pendingAction: 'resume', lastError: null, errorAction: null }));
    try {
      const acknowledgement = await client.resumeSession(roomCode, resumeToken);
      if (disposed) return;
      if (!acknowledgement.ok) {
        forgetRoom(roomCode);
        patch((current) => ({
          ...actionError('resume', acknowledgement.error, current),
          screen: 'LANDING',
          room: null,
          match: null,
          session: null
        }));
        return;
      }
      persistWelcome(acknowledgement.data);
    } catch {
      if (!disposed) setUnexpectedFailure('resume');
    }
  };

  unsubscribeClient.push(
    client.subscribe('connection', (connectionState) => {
      if (connectionState !== 'connected') resumeAttemptedForConnection = false;
      patch((current) => ({ ...current, connectionState }));
      if (connectionState === 'connected') void attemptResume();
    }),
    client.subscribe('session:welcome', (welcome) => persistWelcome(welcome)),
    client.subscribe('room:state', (room) => {
      patch((current) => ({
        ...current,
        room,
        screen: screenForRoom(room),
        pendingAction: null,
        lastError: null,
        errorAction: null
      }));
    }),
    client.subscribe('match:started', (match) => {
      patch((current) => ({
        ...current,
        match,
        screen: 'MATCH',
        pendingAction: null,
        lastError: null,
        errorAction: null
      }));
    }),
    client.subscribe('match:snapshot', (match) => {
      patch((current) => ({ ...current, match }));
    }),
    client.subscribe('match:event', () => undefined),
    client.subscribe('server:error', (error) => {
      const action = state.pendingAction ?? 'server';
      patch((current) => ({
        ...actionError(action, error, current),
        toasts:
          action === 'server'
            ? [...current.toasts, { id: ++toastId, message: error.message, tone: error.recoverable ? 'warning' : 'error' }]
            : current.toasts
      }));
    })
  );

  const actions: GameStore['actions'] = {
    connect(): void {
      client.connect();
    },
    async createRoom(name: string): Promise<void> {
      if (state.pendingAction !== null) return;
      const normalizedName = normalizeNameOrNull(name);
      if (!normalizedName) {
        setFailure('create-room', invalidNameError());
        return;
      }
      if (!beginAction('create-room')) return;
      try {
        const acknowledgement = await client.createRoom(normalizedName);
        if (disposed) return;
        if (!acknowledgement.ok) {
          setFailure('create-room', acknowledgement.error);
          return;
        }
        persistWelcome(acknowledgement.data);
      } catch {
        if (!disposed) setUnexpectedFailure('create-room');
      }
    },
    async joinRoom(name: string, code: string): Promise<void> {
      if (state.pendingAction !== null) return;
      const normalizedName = normalizeNameOrNull(name);
      if (!normalizedName) {
        setFailure('join-room', invalidNameError());
        return;
      }
      const normalizedCode = normalizeCodeOrNull(code);
      if (!normalizedCode) {
        setFailure('join-room', invalidRoomCodeError());
        return;
      }
      if (!beginAction('join-room')) return;
      try {
        const acknowledgement = await client.joinRoom(normalizedName, normalizedCode);
        if (disposed) return;
        if (!acknowledgement.ok) {
          setFailure('join-room', acknowledgement.error);
          return;
        }
        persistWelcome(acknowledgement.data);
      } catch {
        if (!disposed) setUnexpectedFailure('join-room');
      }
    },
    async setTeam(team: Team): Promise<void> {
      if (!beginAction('team')) return;
      try {
        const acknowledgement = await client.setTeam(team);
        if (!disposed && !acknowledgement.ok) setFailure('team', acknowledgement.error);
      } catch {
        if (!disposed) setUnexpectedFailure('team');
      }
    },
    async setReady(ready: boolean): Promise<void> {
      if (!beginAction('ready')) return;
      try {
        const acknowledgement = await client.setReady(ready);
        if (!disposed && !acknowledgement.ok) setFailure('ready', acknowledgement.error);
      } catch {
        if (!disposed) setUnexpectedFailure('ready');
      }
    },
    async startMatch(): Promise<void> {
      if (!beginAction('start')) return;
      try {
        const acknowledgement = await client.startMatch();
        if (!disposed && !acknowledgement.ok) setFailure('start', acknowledgement.error);
      } catch {
        if (!disposed) setUnexpectedFailure('start');
      }
    },
    async copyRoomCode(): Promise<void> {
      const roomCode = state.room?.roomCode;
      if (!roomCode) return;
      try {
        await clipboard.writeText(roomCode);
        patch((current) => ({ ...current, copyFeedback: 'copied' }));
      } catch {
        patch((current) => ({ ...current, copyFeedback: 'failed' }));
      }
    },
    toggleSound(): void {
      patch((current) => {
        const soundMuted = !current.soundMuted;
        storage.setItem(SOUND_KEY, String(soundMuted));
        return { ...current, soundMuted };
      });
    },
    dismissToast(id: number): void {
      patch((current) => ({ ...current, toasts: current.toasts.filter((toast) => toast.id !== id) }));
    }
  };

  return {
    getSnapshot(): ClientState {
      return state;
    },
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      for (const unsubscribe of unsubscribeClient) unsubscribe();
      listeners.clear();
      client.disconnect();
      disposed = true;
    },
    actions
  };
}

export function selectSelfPlayer(state: ClientState): RoomPlayer | null {
  const playerId = state.session?.playerId;
  if (!playerId || !state.room) return null;
  return state.room.players.find((player) => player.playerId === playerId) ?? null;
}

export function selectCanStart(state: ClientState): boolean {
  if (!state.room || state.room.phase !== 'LOBBY') return false;
  const connectedPlayers = state.room.players.filter((player) => player.connected);
  return (
    connectedPlayers.length >= 2 &&
    connectedPlayers.some((player) => player.team === 'CYAN') &&
    connectedPlayers.some((player) => player.team === 'AMBER') &&
    connectedPlayers.every((player) => player.ready)
  );
}
