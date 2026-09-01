import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import type { Ack, ServerError, SessionWelcome } from '../../shared/model.js';
import { GAME } from '../../shared/constants.js';
import {
  lobbyChassisSchema,
  lobbyReadySchema,
  lobbySettingsSchema,
  matchInputSchema,
  matchStartSchema,
  resultLobbySchema,
  resultReadySchema,
  roomCreateSchema,
  roomJoinSchema,
  roomLeaveSchema,
  sessionResumeSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from '../../shared/protocol.js';
import { DomainError } from '../rooms/domainError.js';
import type { RoomManager } from '../rooms/roomManager.js';

export type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

type ErrorLogger = Pick<Console, 'error'>;

type SocketHandlerOptions = Readonly<{
  io: GameIo;
  rooms: RoomManager;
  now: () => number;
  logger: ErrorLogger;
  onSession: (socket: GameSocket, welcome: SessionWelcome) => void;
  onLeave: (socket: GameSocket, roomCode: string) => void;
  onDisconnect: (socket: GameSocket) => void;
}>;

type Bucket = {
  tokens: number;
  updatedAt: number;
};

const INVALID_PAYLOAD: ServerError = {
  code: 'INVALID_PAYLOAD',
  message: 'İstek verisi geçersiz.',
  recoverable: true
};

const RATE_LIMITED: ServerError = {
  code: 'RATE_LIMITED',
  message: 'Çok hızlı istek gönderiyorsunuz.',
  recoverable: true
};

const INTERNAL_ERROR: ServerError = {
  code: 'INTERNAL_ERROR',
  message: 'Beklenmeyen bir sunucu hatası oluştu.',
  recoverable: true
};

const LATENCY_SAMPLE_INTERVAL_MS = 2_000;
const LATENCY_IDLE_RECHECK_MS = 200;

function currentTransport(socket: GameSocket): 'websocket' | 'polling' {
  return socket.conn.transport.name === 'websocket' ? 'websocket' : 'polling';
}

function domainError(error: DomainError): ServerError {
  return {
    code: error.code,
    message: error.safeMessage,
    recoverable: error.recoverable
  };
}

class SocketRateLimiter {
  private readonly actions: Bucket;
  private readonly inputs: Bucket;
  private readonly acceptedInputs: Bucket;
  private errorSuppressedUntil = 0;

  constructor(private readonly now: () => number) {
    const timestamp = now();
    this.actions = { tokens: 10, updatedAt: timestamp };
    this.inputs = { tokens: GAME.inputRateLimitPerSecond, updatedAt: timestamp };
    this.acceptedInputs = { tokens: GAME.maxInputFramesPerSecond, updatedAt: timestamp };
  }

  consumeAction(): boolean {
    return this.consume(this.actions, 10);
  }

  consumeInput(): boolean {
    return this.consume(this.inputs, GAME.inputRateLimitPerSecond);
  }

  acceptInput(): boolean {
    return this.consume(this.acceptedInputs, GAME.maxInputFramesPerSecond);
  }

  shouldEmitError(): boolean {
    const timestamp = this.now();
    if (timestamp < this.errorSuppressedUntil) return false;
    this.errorSuppressedUntil = timestamp + 1_000;
    return true;
  }

  private consume(bucket: Bucket, ratePerSecond: number): boolean {
    const timestamp = this.now();
    const elapsedMs = Math.max(0, timestamp - bucket.updatedAt);
    bucket.tokens = Math.min(ratePerSecond, bucket.tokens + (elapsedMs / 1_000) * ratePerSecond);
    bucket.updatedAt = timestamp;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

export function registerSocketHandlers(options: SocketHandlerOptions): void {
  const { io, rooms, now, logger, onSession, onLeave, onDisconnect } = options;

  io.on('connection', (socket) => {
    const limiter = new SocketRateLimiter(now);
    let lastAcceptedInputSeq = -1;
    let latencySampling = false;
    let latencyTimer: ReturnType<typeof setTimeout> | null = null;
    let latencyProbeTimeout: ReturnType<typeof setTimeout> | null = null;
    let activeLatencyProbe: number | null = null;
    let nextLatencyProbe = 0;

    const stopLatencySampling = (): void => {
      latencySampling = false;
      activeLatencyProbe = null;
      if (latencyTimer) clearTimeout(latencyTimer);
      if (latencyProbeTimeout) clearTimeout(latencyProbeTimeout);
      latencyTimer = null;
      latencyProbeTimeout = null;
    };

    const scheduleLatencySample = (): void => {
      if (!latencySampling) return;
      latencyTimer = setTimeout(sampleLatency, LATENCY_SAMPLE_INTERVAL_MS);
    };

    const sampleLatency = (): void => {
      latencyTimer = null;
      if (!latencySampling || activeLatencyProbe !== null) return;
      if (!rooms.isInActiveMatch(socket.id)) {
        latencyTimer = setTimeout(sampleLatency, LATENCY_IDLE_RECHECK_MS);
        return;
      }
      const probeId = ++nextLatencyProbe;
      const startedAt = now();
      activeLatencyProbe = probeId;
      latencyProbeTimeout = setTimeout(() => {
        if (activeLatencyProbe !== probeId) return;
        activeLatencyProbe = null;
        latencyProbeTimeout = null;
        rooms.setPing(socket.id, GAME.maxPingMs);
        scheduleLatencySample();
      }, GAME.maxPingMs);
      socket.emit('network:probe', () => {
        if (!latencySampling || activeLatencyProbe !== probeId) return;
        if (latencyProbeTimeout) clearTimeout(latencyProbeTimeout);
        latencyProbeTimeout = null;
        activeLatencyProbe = null;
        rooms.setPing(socket.id, now() - startedAt);
        scheduleLatencySample();
      });
    };

    const startLatencySampling = (): void => {
      stopLatencySampling();
      latencySampling = true;
      sampleLatency();
    };

    const emitRateLimit = (): void => {
      if (limiter.shouldEmitError()) socket.emit('server:error', RATE_LIMITED);
    };
    const acknowledge = <TPayload, TData>(
      schema: z.ZodType<TPayload>,
      payload: unknown,
      callback: ((acknowledgement: Ack<TData>) => void) | undefined,
      action: (validated: TPayload) => TData,
      success?: (data: TData) => void
    ): void => {
      if (typeof callback !== 'function') {
        socket.emit('server:error', INVALID_PAYLOAD);
        return;
      }
      if (!limiter.consumeAction()) {
        emitRateLimit();
        callback({ ok: false, error: RATE_LIMITED });
        return;
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        callback({ ok: false, error: INVALID_PAYLOAD });
        return;
      }
      try {
        const data = action(parsed.data);
        callback({ ok: true, data });
        success?.(data);
      } catch (error) {
        if (error instanceof DomainError) {
          callback({ ok: false, error: domainError(error) });
          return;
        }
        const correlationId = randomUUID();
        logger.error(`[${correlationId}] Unexpected Socket.IO action failure`, error);
        callback({ ok: false, error: INTERNAL_ERROR });
      }
    };

    const establishSession = (welcome: SessionWelcome): void => {
      void socket.join(welcome.roomCode);
      onSession(socket, welcome);
      rooms.setTransport(socket.id, currentTransport(socket));
      startLatencySampling();
      queueMicrotask(() => socket.emit('session:welcome', welcome));
    };

    socket.conn.on('upgrade', () => {
      try {
        rooms.setTransport(socket.id, currentTransport(socket));
      } catch {
        // Ignore upgrades before a room session exists or after it was torn down.
      }
    });

    socket.on('room:create', (payload, callback) => {
      acknowledge(roomCreateSchema, payload, callback, (validated) => rooms.createRoom(socket.id, validated.name), establishSession);
    });
    socket.on('room:join', (payload, callback) => {
      acknowledge(
        roomJoinSchema,
        payload,
        callback,
        (validated) => rooms.joinRoom(socket.id, validated.roomCode, validated.name),
        establishSession
      );
    });
    socket.on('session:resume', (payload, callback) => {
      acknowledge(
        sessionResumeSchema,
        payload,
        callback,
        (validated) => rooms.resume(socket.id, validated.roomCode, validated.resumeToken),
        establishSession
      );
    });
    socket.on('lobby:chassis', (payload, callback) => {
      acknowledge(lobbyChassisSchema, payload, callback, (validated) => {
        rooms.setChassis(socket.id, validated.chassis);
        return null;
      });
    });
    socket.on('lobby:ready', (payload, callback) => {
      acknowledge(lobbyReadySchema, payload, callback, (validated) => {
        rooms.setReady(socket.id, validated.ready);
        return null;
      });
    });
    socket.on('lobby:settings', (payload, callback) => {
      acknowledge(lobbySettingsSchema, payload, callback, (validated) => {
        rooms.setRoomSettings(socket.id, validated);
        return null;
      });
    });
    socket.on('room:leave', (payload, callback) => {
      acknowledge(roomLeaveSchema, payload, callback, () => {
        const roomCode = rooms.leaveRoom(socket.id);
        stopLatencySampling();
        void socket.leave(roomCode);
        onLeave(socket, roomCode);
        return null;
      });
    });
    socket.on('match:start', (payload, callback) => {
      acknowledge(matchStartSchema, payload, callback, () => {
        rooms.startMatch(socket.id);
        return null;
      });
    });
    socket.on('result:ready', (payload, callback) => {
      acknowledge(resultReadySchema, payload, callback, (validated) => {
        rooms.setResultReady(socket.id, validated.ready);
        return null;
      });
    });
    socket.on('result:lobby', (payload, callback) => {
      acknowledge(resultLobbySchema, payload, callback, () => {
        rooms.returnToLobby(socket.id);
        return null;
      });
    });
    socket.on('match:input', (payload) => {
      const parsed = matchInputSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('server:error', INVALID_PAYLOAD);
        return;
      }
      if (rooms.isInResult(socket.id)) return;
      if (!limiter.consumeInput()) {
        return;
      }
      if (parsed.data.seq <= lastAcceptedInputSeq) return;
      if (!limiter.acceptInput()) return;
      try {
        rooms.applyInput(socket.id, parsed.data);
        lastAcceptedInputSeq = parsed.data.seq;
      } catch (error) {
        if (error instanceof DomainError) {
          socket.emit('server:error', domainError(error));
          return;
        }
        const correlationId = randomUUID();
        logger.error(`[${correlationId}] Unexpected Socket.IO input failure`, error);
        socket.emit('server:error', INTERNAL_ERROR);
      }
    });
    socket.on('disconnect', () => {
      stopLatencySampling();
      rooms.disconnect(socket.id);
      onDisconnect(socket);
    });
  });
}
