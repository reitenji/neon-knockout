import { randomBytes } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { GameEvent, MatchSnapshot, SessionWelcome, Vec2 } from '../../shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js';
import { RoomManager, type RoomManagerTestHarness, type RoomPublication } from '../rooms/roomManager.js';
import { registerSocketHandlers, type GameSocket } from './socketHandlers.js';

export interface GameServer {
  start(): Promise<{ port: number; origin: string }>;
  stop(): Promise<void>;
  rooms: RoomManager;
  testHarness: {
    forceKnockout(roomCode: string, attackerId: string, targetId: string): void;
    disconnectPlayer(roomCode: string, playerId: string): void;
    placePlayer(roomCode: string, playerId: string, position: Vec2, facing: Vec2): void;
    recentEvents(roomCode: string): readonly GameEvent[];
    matchSnapshot(roomCode: string): MatchSnapshot | null;
  } | null;
}

export type CreateGameServerOptions = Readonly<{
  host?: string;
  port?: number;
  enableTestHarness?: boolean;
  clientDirectory?: string | false;
  logger?: Pick<Console, 'error'>;
}>;

type PlayerConnection = Readonly<{ roomCode: string; socketId: string }>;

const TEST_EVENT_HISTORY_LIMIT = 256;

function updateSnapshot(snapshot: MatchSnapshot, publication: Extract<RoomPublication, { type: 'MATCH_EVENT' }>): MatchSnapshot {
  const event = publication.event;
  if (event.type === 'KNOCKOUT') return { ...snapshot, scores: { ...event.scores } };
  if (event.type === 'PHASE') return { ...snapshot, phase: event.phase };
  if (event.type === 'RESULT') {
    return {
      ...snapshot,
      phase: 'FINISHED',
      scores: { ...event.scores },
      winnerPlayerId: event.winnerPlayerId,
      resultReason: event.reason
    };
  }
  return snapshot;
}

export function createGameServer(options: CreateGameServerOptions = {}): GameServer {
  const host = options.host ?? '0.0.0.0';
  const requestedPort = options.port ?? 4173;
  const logger = options.logger ?? console;
  const now = (): number => performance.now();
  const app = express();
  const httpServer: HttpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    transports: ['websocket']
  });
  const roomCodes = new Set<string>();
  const snapshots = new Map<string, MatchSnapshot>();
  const testEventHistory = options.enableTestHarness ? new Map<string, GameEvent[]>() : null;
  const playerConnections = new Map<string, PlayerConnection>();
  const pendingPublications = new Set<NodeJS.Immediate>();
  let startedAt = now();
  let scheduler: NodeJS.Timeout | null = null;
  let lastAdvanceAt = startedAt;
  let activeAddress: { port: number; origin: string } | null = null;
  let starting: Promise<{ port: number; origin: string }> | null = null;
  let restartAfterStop: Promise<{ port: number; origin: string }> | null = null;
  let stopping: Promise<void> | null = null;

  const dispatch = (publication: RoomPublication): void => {
    if (publication.type === 'ROOM_STATE') io.to(publication.roomCode).emit('room:state', publication.state);
    if (publication.type === 'MATCH_STARTED') io.to(publication.roomCode).emit('match:started', publication.snapshot);
    if (publication.type === 'MATCH_SNAPSHOT') io.to(publication.roomCode).emit('match:snapshot', publication.snapshot);
    if (publication.type === 'MATCH_EVENT') io.to(publication.roomCode).emit('match:event', publication.event);
  };

  const publish = (publication: RoomPublication): void => {
    if (publication.type === 'ROOM_STATE') roomCodes.add(publication.roomCode);
    if (publication.type === 'ROOM_CLOSED') {
      roomCodes.delete(publication.roomCode);
      snapshots.delete(publication.roomCode);
      testEventHistory?.delete(publication.roomCode);
    }
    if (publication.type === 'MATCH_STARTED' || publication.type === 'MATCH_SNAPSHOT') {
      if (publication.type === 'MATCH_STARTED') testEventHistory?.delete(publication.roomCode);
      snapshots.set(publication.roomCode, publication.snapshot);
    }
    if (publication.type === 'MATCH_EVENT') {
      if (testEventHistory) {
        const history = testEventHistory.get(publication.roomCode) ?? [];
        history.push(structuredClone(publication.event));
        if (history.length > TEST_EVENT_HISTORY_LIMIT) {
          history.splice(0, history.length - TEST_EVENT_HISTORY_LIMIT);
        }
        testEventHistory.set(publication.roomCode, history);
      }
      const snapshot = snapshots.get(publication.roomCode);
      if (snapshot) snapshots.set(publication.roomCode, updateSnapshot(snapshot, publication));
    }
    const immediate = setImmediate(() => {
      pendingPublications.delete(immediate);
      dispatch(publication);
    });
    pendingPublications.add(immediate);
  };

  let roomTestHarness: RoomManagerTestHarness | null = null;
  const rooms = new RoomManager({
    now,
    randomBytes,
    publish,
    ...(options.enableTestHarness
      ? { bindTestHarness: (harness: RoomManagerTestHarness): void => { roomTestHarness = harness; } }
      : {})
  });

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      rooms: roomCodes.size,
      uptimeSeconds: Math.max(0, (now() - startedAt) / 1_000)
    });
  });

  const clientDirectory = options.clientDirectory === undefined ? resolve(process.cwd(), 'dist/client') : options.clientDirectory;
  if (clientDirectory !== false) {
    app.use(express.static(clientDirectory));
    app.use((request, response, next) => {
      if (request.path === '/health' || request.path.startsWith('/socket.io')) {
        next();
        return;
      }
      response.sendFile('index.html', { root: clientDirectory }, (error) => {
        if (error) next(error);
      });
    });
  }

  registerSocketHandlers({
    io,
    rooms,
    now,
    logger,
    onSession: (socket: GameSocket, welcome: SessionWelcome) => {
      playerConnections.set(welcome.playerId, { roomCode: welcome.roomCode, socketId: socket.id });
    },
    onDisconnect: (socket: GameSocket) => {
      for (const [playerId, connection] of playerConnections) {
        if (connection.socketId === socket.id) playerConnections.delete(playerId);
      }
    }
  });

  const listen = async (): Promise<{ port: number; origin: string }> => {
    await new Promise<void>((resolveStart, rejectStart) => {
      const onError = (error: Error): void => {
        httpServer.off('listening', onListening);
        rejectStart(error);
      };
      const onListening = (): void => {
        httpServer.off('error', onError);
        resolveStart();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(requestedPort, host);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Game server did not bind a TCP port.');
    const originHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    activeAddress = { port: address.port, origin: `http://${originHost}:${address.port}` };
    startedAt = now();
    lastAdvanceAt = startedAt;
    scheduler = setInterval(() => {
      const current = now();
      rooms.advance(current - lastAdvanceAt);
      lastAdvanceAt = current;
    }, 1_000 / 30);
    return activeAddress;
  };

  const start = (): Promise<{ port: number; origin: string }> => {
    if (stopping) {
      if (restartAfterStop) return restartAfterStop;
      const stopToJoin = stopping;
      const sharedStart = stopToJoin.then(listen).finally(() => {
        if (starting === sharedStart) starting = null;
        if (restartAfterStop === sharedStart) restartAfterStop = null;
      });
      restartAfterStop = sharedStart;
      starting = sharedStart;
      return sharedStart;
    }
    if (starting) return starting;
    if (activeAddress) return Promise.resolve(activeAddress);
    const sharedStart = listen().finally(() => {
      if (starting === sharedStart) starting = null;
    });
    starting = sharedStart;
    return sharedStart;
  };

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      try {
        const startToJoin = starting;
        if (startToJoin) {
          try {
            await startToJoin;
          } catch {
            // A failed start still needs the same resource and state cleanup.
          }
        }
        if (scheduler) {
          clearInterval(scheduler);
          scheduler = null;
        }
        if (activeAddress || httpServer.listening) {
          await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
          if (httpServer.listening) {
            await new Promise<void>((resolveClose, rejectClose) => {
              httpServer.close((error) => error ? rejectClose(error) : resolveClose());
            });
          }
        }
        for (const immediate of pendingPublications) clearImmediate(immediate);
        pendingPublications.clear();
        rooms.reset();
        roomCodes.clear();
        snapshots.clear();
        testEventHistory?.clear();
        playerConnections.clear();
        activeAddress = null;
      } finally {
        stopping = null;
      }
    })();
    return stopping;
  };

  const testHarness = options.enableTestHarness
    ? {
        forceKnockout: (roomCode: string, attackerId: string, targetId: string): void =>
          rooms.forceKnockout(roomCode, attackerId, targetId),
        disconnectPlayer: (roomCode: string, playerId: string): void => {
          const connection = playerConnections.get(playerId);
          if (!connection || connection.roomCode !== roomCode) return;
          io.sockets.sockets.get(connection.socketId)?.disconnect(true);
        },
        placePlayer: (roomCode: string, playerId: string, position: Vec2, facing: Vec2): void => {
          if (!roomTestHarness) throw new Error('Test harness was not bound.');
          roomTestHarness.placePlayer(roomCode, playerId, position, facing);
        },
        recentEvents: (roomCode: string): readonly GameEvent[] =>
          structuredClone(testEventHistory?.get(roomCode) ?? []),
        matchSnapshot: (roomCode: string): MatchSnapshot | null => {
          const snapshot = snapshots.get(roomCode);
          return snapshot ? structuredClone(snapshot) : null;
        }
      }
    : null;

  return { start, stop, rooms, testHarness };
}
