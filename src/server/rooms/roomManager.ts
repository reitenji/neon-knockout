import { timingSafeEqual } from 'node:crypto';
import { ARENA, CHASSIS, GAME } from '../../shared/constants.js';
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from '../../shared/roomSettings.js';
import type {
  Chassis,
  GameEvent,
  InputFrame,
  MatchSnapshot,
  PlayerNetworkStatus,
  PlayerNetworkTransport,
  PlayerAccent,
  PlayerStats,
  ResultPlayer,
  RoomPhase,
  RoomState,
  SessionWelcome,
  Vec2
} from '../../shared/model.js';
import { normalizePlayerName, normalizeRoomCode } from '../../shared/names.js';
import {
  forceKnockout as forceMatchKnockout,
  resumePausedMatch,
  setMatchPaused,
  setPlayerConnected,
  snapshotMatch,
  stepMatch
} from '../game/simulation.js';
import { createEmptyInput, createMatchState, createPlayerStats, type MatchState } from '../game/state.js';
import { clearPulses, removePulsesOwnedBy } from '../game/projectiles.js';
import { DomainError } from './domainError.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIMULATION_STEP_MS = 1_000 / GAME.tickRate;
const SNAPSHOT_INTERVAL_MS = 1_000 / GAME.snapshotRate;
const MAX_ELAPSED_MS = 250;
const MAX_STEPS_PER_ADVANCE = 5;
const TIMER_EPSILON_MS = 1e-7;
const NETWORK_SAMPLE_LIMIT = 8;
const MAX_TEST_COMBAT_STEPS = 240;

export type RoomPublication =
  | { type: 'ROOM_STATE'; roomCode: string; state: RoomState }
  | { type: 'MATCH_STARTED'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_SNAPSHOT'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_EVENT'; roomCode: string; event: GameEvent }
  | { type: 'ROOM_CLOSED'; roomCode: string };

type RoomPlayer = {
  playerId: string;
  name: string;
  chassis: Chassis;
  accent: PlayerAccent;
  ready: boolean;
  connected: boolean;
  stats: PlayerStats;
  resumeToken: Uint8Array;
  order: number;
  expiresAt: number | null;
  reconnectAnchor: Vec2 | null;
};

type ResultPlayerRecord = {
  playerId: string;
  name: string;
  chassis: Chassis;
  accent: PlayerAccent;
  stats: PlayerStats;
  order: number;
  left: boolean;
};

type Room = {
  roomCode: string;
  phase: RoomPhase;
  hostPlayerId: string;
  settings: RoomSettings;
  players: Map<string, RoomPlayer>;
  nextPlayerOrder: number;
  match: MatchState | null;
  resultPlayers: Map<string, ResultPlayerRecord> | null;
  network: Map<string, PlayerNetworkRuntime>;
  inputs: Map<string, InputFrame>;
  accumulatorMs: number;
  snapshotAccumulatorMs: number;
};

type PlayerNetworkRuntime = {
  currentMs: number | null;
  medianMs: number | null;
  jitterMs: number | null;
  transport: PlayerNetworkTransport;
  samples: number[];
};

type ConnectionSession = Readonly<{ roomCode: string; playerId: string }>;

type RoomManagerDependencies = Readonly<{
  now: () => number;
  randomBytes: (size: number) => Uint8Array;
  publish: (event: RoomPublication) => void;
  bindTestHarness?: (harness: RoomManagerTestHarness) => void;
}>;

export type TestCombatPlayerStage = Readonly<{
  playerId: string;
  position: Vec2;
  facing: Vec2;
  overload: number;
}>;

export type TestCombatStep = Readonly<{
  elapsedMs: number;
  inputs?: readonly Readonly<{ playerId: string; input: InputFrame }>[];
}>;

export type TestCombatScript = Readonly<{
  preservePulses?: boolean;
  players: readonly TestCombatPlayerStage[];
  steps: readonly TestCombatStep[];
}>;

export type RoomManagerTestHarness = Readonly<{
  placePlayer(roomCode: string, playerId: string, position: Vec2, facing: Vec2): void;
  runCombatScript(roomCode: string, script: TestCombatScript): void;
}>;

export type DebugRoom = Readonly<{
  phase: RoomPhase;
  connectedCount: number;
  reservedCount: number;
  playerIds: readonly string[];
  tick: number | null;
  scores: Readonly<Record<string, number>> | null;
}>;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function emptyStats(): PlayerStats {
  return { ...createPlayerStats() };
}

function createNetworkRuntime(transport: PlayerNetworkTransport = 'polling'): PlayerNetworkRuntime {
  return { currentMs: null, medianMs: null, jitterMs: null, transport, samples: [] };
}

function roundMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]);
}

function pushBounded(values: number[], next: number): void {
  values.push(next);
  if (values.length > NETWORK_SAMPLE_LIMIT) values.splice(0, values.length - NETWORK_SAMPLE_LIMIT);
}

function networkStatus(runtime: PlayerNetworkRuntime): PlayerNetworkStatus {
  return {
    currentMs: runtime.currentMs,
    medianMs: runtime.medianMs,
    jitterMs: runtime.jitterMs,
    transport: runtime.transport
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, ConnectionSession>();

  constructor(private readonly deps: RoomManagerDependencies) {
    deps.bindTestHarness?.({
      placePlayer: (roomCode, playerId, position, facing) =>
        this.placePlayerForTesting(roomCode, playerId, position, facing),
      runCombatScript: (roomCode, script) => this.runCombatScriptForTesting(roomCode, script)
    });
  }

  reset(): void {
    for (const room of this.rooms.values()) {
      if (room.match) clearPulses(room.match);
    }
    this.rooms.clear();
    this.connections.clear();
  }

  createRoom(connectionId: string, name: string): SessionWelcome {
    this.assertConnectionAvailable(connectionId);
    const roomCode = this.createRoomCode();
    const normalizedName = this.normalizeName(name);
    const playerId = bytesToHex(this.deps.randomBytes(16));
    const resumeToken = this.deps.randomBytes(32);
    const player: RoomPlayer = {
      playerId,
      name: normalizedName,
      chassis: CHASSIS[0],
      accent: 0,
      ready: false,
      connected: true,
      stats: emptyStats(),
      resumeToken,
      order: 0,
      expiresAt: null,
      reconnectAnchor: null
    };
    const room: Room = {
      roomCode,
      phase: 'LOBBY',
      hostPlayerId: playerId,
      settings: { ...DEFAULT_ROOM_SETTINGS },
      players: new Map([[playerId, player]]),
      nextPlayerOrder: 1,
      match: null,
      resultPlayers: null,
      network: new Map([[playerId, createNetworkRuntime()]]),
      inputs: new Map(),
      accumulatorMs: 0,
      snapshotAccumulatorMs: 0
    };
    this.rooms.set(roomCode, room);
    this.connections.set(connectionId, { roomCode, playerId });
    this.publishRoom(room);
    return { playerId, roomCode, resumeToken: bytesToHex(resumeToken), resumed: false };
  }

  joinRoom(connectionId: string, roomCode: string, name: string): SessionWelcome {
    this.assertConnectionAvailable(connectionId);
    const room = this.requireRoom(roomCode);
    if (room.phase === 'COUNTDOWN' || room.phase === 'MATCH') {
      throw new DomainError('MATCH_IN_PROGRESS', 'Maç devam ederken yeni oyuncu katılamaz.', true);
    }
    if (room.players.size >= GAME.maxPlayers) throw new DomainError('ROOM_FULL', 'Oda dolu.', true);
    const normalizedName = this.normalizeName(name);
    const playerId = bytesToHex(this.deps.randomBytes(16));
    const resumeToken = this.deps.randomBytes(32);
    const order = room.nextPlayerOrder++;
    room.players.set(playerId, {
      playerId,
      name: normalizedName,
      chassis: CHASSIS[order % CHASSIS.length],
      accent: this.lowestUnusedAccent(room),
      ready: false,
      connected: true,
      stats: emptyStats(),
      resumeToken,
      order,
      expiresAt: null,
      reconnectAnchor: null
    });
    room.network.set(playerId, createNetworkRuntime());
    this.connections.set(connectionId, { roomCode: room.roomCode, playerId });
    this.publishRoom(room);
    return { playerId, roomCode: room.roomCode, resumeToken: bytesToHex(resumeToken), resumed: false };
  }

  resume(connectionId: string, roomCode: string, resumeToken: string): SessionWelcome {
    this.assertConnectionAvailable(connectionId);
    const room = this.requireRoom(roomCode);
    const token = this.parseResumeToken(resumeToken);
    const now = this.deps.now();
    const player = [...room.players.values()].find((candidate) =>
      !candidate.connected && candidate.expiresAt !== null && candidate.expiresAt > now &&
      candidate.resumeToken.byteLength === token.byteLength && timingSafeEqual(candidate.resumeToken, token));
    if (!player) {
      throw new DomainError('INVALID_RESUME_TOKEN', 'Yeniden bağlanma anahtarı geçersiz veya süresi dolmuş.', true);
    }
    player.connected = true;
    player.expiresAt = null;
    this.connections.set(connectionId, { roomCode: room.roomCode, playerId: player.playerId });
    if (!room.players.get(room.hostPlayerId)?.connected) this.migrateHost(room);
    if (room.match?.players[player.playerId] && (room.phase === 'COUNTDOWN' || room.phase === 'MATCH')) {
      this.publishMatchEvents(room, setPlayerConnected(room.match, player.playerId, true));
      player.reconnectAnchor = { ...room.match.players[player.playerId].position };
      this.reconcilePopulation(room);
      this.publishSnapshot(room);
    }
    this.publishRoom(room);
    return { playerId: player.playerId, roomCode: room.roomCode, resumeToken, resumed: true };
  }

  setChassis(connectionId: string, chassis: Chassis): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY') throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    if (!(CHASSIS as readonly string[]).includes(chassis)) {
      throw new DomainError('INVALID_CHASSIS', 'Gövde seçimi geçersiz.', true);
    }
    if (player.chassis === chassis) return;
    player.chassis = chassis;
    player.ready = false;
    this.publishRoom(room);
  }

  setReady(connectionId: string, ready: boolean): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY') throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    player.ready = ready;
    this.publishRoom(room);
  }

  setRoomSettings(connectionId: string, settings: RoomSettings): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY') throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    if (room.hostPlayerId !== player.playerId) {
      throw new DomainError('NOT_HOST', 'Bu işlemi yalnızca oda sahibi yapabilir.', true);
    }
    if (room.settings.durationMs === settings.durationMs && room.settings.knockoutTarget === settings.knockoutTarget) return;
    room.settings = { ...settings };
    for (const candidate of room.players.values()) candidate.ready = false;
    this.publishRoom(room);
  }

  leaveRoom(connectionId: string): string {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    const leavingHost = room.hostPlayerId === player.playerId;
    if (room.phase === 'RESULT') this.markResultPlayerLeft(room, player);
    this.connections.delete(connectionId);
    room.inputs.delete(player.playerId);
    room.players.delete(player.playerId);
    if (room.match) {
      removePulsesOwnedBy(room.match, player.playerId);
      delete room.match.players[player.playerId];
      delete room.match.scores[player.playerId];
    }
    room.network.delete(player.playerId);
    if (leavingHost) this.reassignHost(room);
    if (room.players.size === 0) {
      if (room.match) clearPulses(room.match);
      this.rooms.delete(room.roomCode);
      this.deps.publish({ type: 'ROOM_CLOSED', roomCode: room.roomCode });
      return room.roomCode;
    }
    if (room.match && (room.phase === 'COUNTDOWN' || room.phase === 'MATCH')) {
      if (!this.reconcilePopulation(room)) return room.roomCode;
      this.publishSnapshot(room);
    }
    this.publishRoom(room);
    return room.roomCode;
  }

  startMatch(connectionId: string): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY' && room.phase !== 'RESULT') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    if (room.hostPlayerId !== player.playerId) {
      throw new DomainError('NOT_HOST', 'Bu işlemi yalnızca oda sahibi yapabilir.', true);
    }
    const connected = [...room.players.values()].filter((candidate) => candidate.connected);
    if (connected.length < GAME.minPlayers) {
      throw new DomainError('NOT_ENOUGH_PLAYERS', 'Maçı başlatmak için en az iki bağlı oyuncu gerekir.', true);
    }
    if (connected.some((candidate) => !candidate.ready)) {
      throw new DomainError('NOT_READY', 'Tüm bağlı oyuncular hazır olmalıdır.', true);
    }
    for (const candidate of room.players.values()) {
      candidate.ready = false;
      candidate.stats = emptyStats();
      candidate.reconnectAnchor = null;
    }
    if (room.match) clearPulses(room.match);
    room.match = createMatchState([...room.players.values()].map((candidate) => ({
      playerId: candidate.playerId,
      name: candidate.name,
      chassis: candidate.chassis,
      accent: candidate.accent,
      connected: candidate.connected
    })), this.deps.now(), room.settings);
    for (const candidate of room.players.values()) {
      const runtime = room.network.get(candidate.playerId) ?? createNetworkRuntime();
      runtime.currentMs = null;
      runtime.medianMs = null;
      runtime.jitterMs = null;
      runtime.samples = [];
      room.network.set(candidate.playerId, runtime);
    }
    room.resultPlayers = null;
    room.phase = 'COUNTDOWN';
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    this.publishRoom(room);
    this.deps.publish({ type: 'MATCH_STARTED', roomCode: room.roomCode, snapshot: this.snapshotForRoom(room) });
  }

  applyInput(connectionId: string, input: InputFrame): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH')) {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    const queued = room.inputs.get(player.playerId);
    const processed = room.match.players[player.playerId]?.lastProcessedInputSeq ?? -1;
    if (input.seq <= Math.max(queued?.seq ?? -1, processed)) return;
    const unprocessed = queued && queued.seq > processed ? queued : null;
    room.inputs.set(player.playerId, unprocessed
      ? { ...input, quick: unprocessed.quick || input.quick, dash: unprocessed.dash || input.dash }
      : input);
  }

  setPing(connectionId: string, pingMs: number): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH')) return;
    const normalized = Math.round(Math.max(0, Math.min(GAME.maxPingMs, pingMs)));
    const runtime = room.network.get(player.playerId) ?? createNetworkRuntime();
    runtime.currentMs = normalized;
    pushBounded(runtime.samples, normalized);
    runtime.medianMs = roundMedian(runtime.samples);
    runtime.jitterMs = roundMedian(runtime.samples.slice(1).map((sample, index) =>
      Math.abs(sample - runtime.samples[index]!)
    )) ?? 0;
    room.network.set(player.playerId, runtime);
  }

  setTransport(connectionId: string, transport: PlayerNetworkTransport): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    const runtime = room.network.get(player.playerId) ?? createNetworkRuntime(transport);
    runtime.transport = transport;
    room.network.set(player.playerId, runtime);
  }

  isInActiveMatch(connectionId: string): boolean {
    const session = this.connections.get(connectionId);
    const room = session ? this.rooms.get(session.roomCode) : null;
    const player = session ? room?.players.get(session.playerId) : null;
    return Boolean(room && player?.connected && room.match &&
      (room.phase === 'COUNTDOWN' || room.phase === 'MATCH'));
  }

  forceKnockout(roomCode: string, attackerId: string, targetId: string): void {
    const room = this.requireRoom(roomCode);
    if (!room.match || room.phase !== 'MATCH') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    this.publishMatchEvents(room, forceMatchKnockout(room.match, attackerId, targetId));
  }

  debugRoom(roomCode: string): DebugRoom | null {
    let normalized: string;
    try {
      normalized = normalizeRoomCode(roomCode);
    } catch {
      return null;
    }
    const room = this.rooms.get(normalized);
    if (!room) return null;
    const ordered = this.orderedPlayers(room);
    return {
      phase: room.phase,
      connectedCount: ordered.filter((player) => player.connected).length,
      reservedCount: ordered.filter((player) => !player.connected).length,
      playerIds: ordered.map((player) => player.playerId),
      tick: room.match?.tick ?? null,
      scores: room.match ? { ...room.match.scores } : null
    };
  }

  setResultReady(connectionId: string, ready: boolean): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'RESULT') throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    player.ready = ready;
    this.publishRoom(room);
  }

  returnToLobby(connectionId: string): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'RESULT') throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    if (room.hostPlayerId !== player.playerId) {
      throw new DomainError('NOT_HOST', 'Bu işlemi yalnızca oda sahibi yapabilir.', true);
    }
    this.resetMatchToLobby(room);
    this.publishRoom(room);
  }

  disconnect(connectionId: string): void {
    const session = this.connections.get(connectionId);
    if (!session) return;
    this.connections.delete(connectionId);
    const room = this.rooms.get(session.roomCode);
    const player = room?.players.get(session.playerId);
    if (!room || !player) return;
    player.connected = false;
    player.ready = false;
    player.expiresAt = this.deps.now() + GAME.reconnectGraceMs;
    player.reconnectAnchor = null;
    room.inputs.delete(player.playerId);
    if (room.match?.players[player.playerId]) {
      this.publishMatchEvents(room, setPlayerConnected(room.match, player.playerId, false));
      this.reconcilePopulation(room);
    }
    if (room.hostPlayerId === player.playerId) this.migrateHost(room);
    this.publishRoom(room);
  }

  advance(elapsedMs: number): void {
    const now = this.deps.now();
    for (const room of [...this.rooms.values()]) {
      let membershipChanged = false;
      for (const player of [...room.players.values()]) {
        if (!player.connected && player.expiresAt !== null && player.expiresAt <= now) {
          const expiredHost = room.hostPlayerId === player.playerId;
          if (room.phase === 'RESULT') this.markResultPlayerLeft(room, player);
          if (room.match) removePulsesOwnedBy(room.match, player.playerId);
          room.players.delete(player.playerId);
          if (room.match) {
            delete room.match.players[player.playerId];
            delete room.match.scores[player.playerId];
          }
          room.network.delete(player.playerId);
          if (expiredHost) this.reassignHost(room);
          membershipChanged = true;
        }
      }
      if (room.players.size === 0) {
        if (room.match) clearPulses(room.match);
        this.rooms.delete(room.roomCode);
        this.deps.publish({ type: 'ROOM_CLOSED', roomCode: room.roomCode });
        continue;
      }
      if (room.match && (room.phase === 'COUNTDOWN' || room.phase === 'MATCH')) {
        if (!this.reconcilePopulation(room)) continue;
      }
      if (membershipChanged) this.publishRoom(room);
      if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH') || room.match.phase === 'PAUSED') continue;

      const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(elapsedMs, MAX_ELAPSED_MS)) : 0;
      room.accumulatorMs += elapsed;
      let steps = 0;
      while (room.accumulatorMs + TIMER_EPSILON_MS >= SIMULATION_STEP_MS && steps < MAX_STEPS_PER_ADVANCE) {
        for (const matchPlayer of Object.values(room.match.players)) {
          if (matchPlayer.respawnRemainingMs > 0 &&
            matchPlayer.respawnRemainingMs <= SIMULATION_STEP_MS + TIMER_EPSILON_MS) {
            matchPlayer.respawnRemainingMs = SIMULATION_STEP_MS;
          }
        }
        const stepDuration = room.match.phase === 'COUNTDOWN' &&
          room.match.countdownRemainingMs <= SIMULATION_STEP_MS + TIMER_EPSILON_MS
          ? room.match.countdownRemainingMs
          : SIMULATION_STEP_MS;
        let events = [...stepMatch(room.match, room.inputs, stepDuration)];
        events = this.finalizeReconnectAnchors(room, events);
        room.accumulatorMs -= SIMULATION_STEP_MS;
        room.snapshotAccumulatorMs += SIMULATION_STEP_MS;
        steps += 1;
        this.publishMatchEvents(room, events);
        if (room.match.phase === 'FINISHED') break;
        if (room.phase === 'COUNTDOWN' && room.match.phase === 'REGULATION') {
          room.phase = 'MATCH';
          this.publishRoom(room);
        }
        while (room.snapshotAccumulatorMs + TIMER_EPSILON_MS >= SNAPSHOT_INTERVAL_MS) {
          room.snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;
          this.publishSnapshot(room);
        }
      }
      if (Math.abs(room.accumulatorMs) < TIMER_EPSILON_MS) room.accumulatorMs = 0;
      if (Math.abs(room.snapshotAccumulatorMs) < TIMER_EPSILON_MS) room.snapshotAccumulatorMs = 0;
    }
  }

  private createRoomCode(): string {
    for (;;) {
      const roomCode = [...this.deps.randomBytes(4)]
        .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
      if (!this.rooms.has(roomCode)) return roomCode;
    }
  }

  private lowestUnusedAccent(room: Room): PlayerAccent {
    const used = new Set([...room.players.values()].map((player) => player.accent));
    for (let accent = 0; accent < GAME.maxPlayers; accent += 1) {
      if (!used.has(accent as PlayerAccent)) return accent as PlayerAccent;
    }
    throw new DomainError('ROOM_FULL', 'Oda dolu.', true);
  }

  private orderedPlayers(room: Room): RoomPlayer[] {
    return [...room.players.values()].sort((left, right) => left.order - right.order);
  }

  private migrateHost(room: Room): void {
    const successor = this.orderedPlayers(room).find((player) => player.connected);
    if (successor) room.hostPlayerId = successor.playerId;
  }

  private reassignHost(room: Room): void {
    const successor = this.orderedPlayers(room).find((player) => player.connected) ?? this.orderedPlayers(room)[0];
    if (successor) room.hostPlayerId = successor.playerId;
  }

  private reconcilePopulation(room: Room): boolean {
    if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH')) return true;
    const connectedCount = [...room.players.values()].filter((player) => player.connected).length;
    if (connectedCount >= GAME.minPlayers) {
      if (room.match.phase === 'PAUSED') this.publishMatchEvents(room, resumePausedMatch(room.match));
      return true;
    }
    const now = this.deps.now();
    const validReservations = [...room.players.values()].filter(
      (player) => !player.connected && player.expiresAt !== null && player.expiresAt > now
    );
    if (connectedCount + validReservations.length >= GAME.minPlayers) {
      const reconnectRemainingMs = Math.max(...validReservations.map((player) => player.expiresAt! - now));
      if (room.match.phase !== 'PAUSED') {
        this.publishMatchEvents(room, setMatchPaused(room.match, reconnectRemainingMs));
      } else {
        room.match.pauseRemainingMs = reconnectRemainingMs;
      }
      return true;
    }
    this.publishNoContest(room);
    return false;
  }

  private publishNoContest(room: Room): void {
    if (!room.match) return;
    if (room.match.phase !== 'PAUSED') setMatchPaused(room.match, 0);
    room.match.pauseRemainingMs = 0;
    const result = stepMatch(room.match, room.inputs, 0).find(
      (event): event is Extract<GameEvent, { type: 'RESULT' }> => event.type === 'RESULT' && event.reason === 'NO_CONTEST'
    );
    if (result) this.deps.publish({ type: 'MATCH_EVENT', roomCode: room.roomCode, event: result });
    this.resetMatchToLobby(room);
    this.publishRoom(room);
  }

  private finalizeReconnectAnchors(room: Room, events: GameEvent[]): GameEvent[] {
    if (!room.match) return events;
    const replacements = new Map<string, Vec2>();
    for (const player of room.players.values()) {
      const matchPlayer = room.match.players[player.playerId];
      if (!player.reconnectAnchor || !matchPlayer || matchPlayer.respawnRemainingMs > 0) continue;
      matchPlayer.position = { ...player.reconnectAnchor };
      replacements.set(player.playerId, { ...player.reconnectAnchor });
      player.reconnectAnchor = null;
    }
    if (replacements.size === 0) return events;
    return events.map((event) => event.type === 'RESPAWN' && replacements.has(event.playerId)
      ? { ...event, position: { ...replacements.get(event.playerId)! } }
      : event);
  }

  private publishMatchEvents(room: Room, events: readonly GameEvent[]): void {
    for (const event of events) this.deps.publish({ type: 'MATCH_EVENT', roomCode: room.roomCode, event });
    if (room.match?.phase === 'FINISHED' && room.phase !== 'RESULT') this.enterResult(room);
  }

  private publishSnapshot(room: Room): void {
    if (!room.match) return;
    this.deps.publish({ type: 'MATCH_SNAPSHOT', roomCode: room.roomCode, snapshot: this.snapshotForRoom(room) });
  }

  private enterResult(room: Room): void {
    if (!room.match) return;
    clearPulses(room.match);
    room.phase = 'RESULT';
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    room.resultPlayers = new Map();
    for (const player of room.players.values()) {
      const matchPlayer = room.match.players[player.playerId];
      if (matchPlayer) player.stats = { ...matchPlayer.stats };
      player.ready = false;
      player.reconnectAnchor = null;
      this.rememberResultPlayer(room, player);
    }
    this.publishRoom(room);
  }

  private resetMatchToLobby(room: Room): void {
    if (room.match) clearPulses(room.match);
    room.match = null;
    room.resultPlayers = null;
    room.phase = 'LOBBY';
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    for (const player of room.players.values()) {
      player.ready = false;
      player.stats = emptyStats();
      player.reconnectAnchor = null;
    }
  }

  private pauseRemainingMs(room: Room): number | null {
    const now = this.deps.now();
    const deadlines = [...room.players.values()]
      .filter((player) => !player.connected && player.expiresAt !== null && player.expiresAt > now)
      .map((player) => player.expiresAt! - now);
    return deadlines.length > 0 ? Math.max(...deadlines) : null;
  }

  private runCombatScriptForTesting(roomCode: string, script: TestCombatScript): void {
    const room = this.requireRoom(roomCode);
    if (!room.match || room.phase !== 'MATCH' ||
      (room.match.phase !== 'REGULATION' && room.match.phase !== 'SUDDEN_DEATH')) {
      throw new Error('Test combat script requires an active match.');
    }
    const matchPlayerIds = Object.keys(room.match.players).sort();
    const stagedPlayerIds = script.players.map((player) => player.playerId).sort();
    if (matchPlayerIds.length !== stagedPlayerIds.length ||
      matchPlayerIds.some((playerId, index) => playerId !== stagedPlayerIds[index])) {
      throw new Error('Test combat script must stage every active match player exactly once.');
    }
    if (script.steps.length === 0 || script.steps.length > MAX_TEST_COMBAT_STEPS) {
      throw new RangeError(`Test combat script requires 1-${MAX_TEST_COMBAT_STEPS} steps.`);
    }

    const normalizedStages = script.players.map((stage) => {
      const withinBounds = stage.position.x >= 0 && stage.position.x <= ARENA.width &&
        stage.position.y >= 0 && stage.position.y <= ARENA.height;
      const facingLength = Math.hypot(stage.facing.x, stage.facing.y);
      if (!Number.isFinite(stage.position.x) || !Number.isFinite(stage.position.y) || !withinBounds ||
        !Number.isFinite(facingLength) || facingLength === 0 || !Number.isFinite(stage.overload) ||
        stage.overload < 0 || stage.overload > GAME.maxOverload) {
        throw new RangeError('Test combat script requires bounded position, facing, and overload values.');
      }
      return {
        ...stage,
        facing: { x: stage.facing.x / facingLength, y: stage.facing.y / facingLength }
      };
    });

    const inputSequences = new Map(matchPlayerIds.map((playerId) => [playerId, -1]));
    for (const step of script.steps) {
      if (!Number.isFinite(step.elapsedMs) || step.elapsedMs < 0 || step.elapsedMs > MAX_ELAPSED_MS) {
        throw new RangeError(`Test combat step duration must be between 0 and ${MAX_ELAPSED_MS} ms.`);
      }
      const stepPlayerIds = new Set<string>();
      for (const entry of step.inputs ?? []) {
        if (!room.match.players[entry.playerId] || stepPlayerIds.has(entry.playerId)) {
          throw new Error('Test combat step inputs require unique active player ids.');
        }
        const input = entry.input;
        if (!Number.isSafeInteger(input.seq) || input.seq <= inputSequences.get(entry.playerId)! ||
          !Number.isFinite(input.moveX) || !Number.isFinite(input.moveY) ||
          !Number.isFinite(input.aimX) || !Number.isFinite(input.aimY) ||
          typeof input.quick !== 'boolean' || typeof input.heavy !== 'boolean' || typeof input.dash !== 'boolean') {
          throw new RangeError('Test combat step inputs must be finite, monotonic input frames.');
        }
        stepPlayerIds.add(entry.playerId);
        inputSequences.set(entry.playerId, input.seq);
      }
    }

    if (!script.preservePulses) clearPulses(room.match);
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    for (const stage of normalizedStages) {
      const player = room.match.players[stage.playerId];
      player.position = { ...stage.position };
      player.velocity = { x: 0, y: 0 };
      player.facing = { ...stage.facing };
      player.overload = stage.overload;
      player.comboStep = 0;
      player.attack = null;
      player.chargeMs = 0;
      player.charging = false;
      player.perfectDodgeConsumed = false;
      player.dashRemainingMs = 0;
      player.dashInvulnerabilityRemainingMs = 0;
      player.dashCooldownRemainingMs = 0;
      player.dashDirection = { ...stage.facing };
      player.hitstunRemainingMs = 0;
      player.respawnRemainingMs = 0;
      player.resetOverloadOnRespawn = false;
      player.protectionRemainingMs = 0;
      player.lastProcessedInputSeq = -1;
      player.latestInput = { ...createEmptyInput(), aimX: stage.facing.x, aimY: stage.facing.y };
      player.previousQuick = false;
      player.previousHeavy = false;
      player.previousDash = false;
      player.bufferedQuick = false;
      player.lastAttackerId = null;
      player.lastAttackerAtMs = null;
    }

    for (const step of script.steps) {
      for (const entry of step.inputs ?? []) room.inputs.set(entry.playerId, entry.input);
      let events = [...stepMatch(room.match, room.inputs, step.elapsedMs)];
      events = this.finalizeReconnectAnchors(room, events);
      this.publishMatchEvents(room, events);
      this.publishSnapshot(room);
      if (events.some((event) => event.type === 'RESULT')) break;
    }
  }

  private placePlayerForTesting(roomCode: string, playerId: string, position: Vec2, facing: Vec2): void {
    const room = this.requireRoom(roomCode);
    const player = room.match?.players[playerId];
    if (!player || room.phase !== 'MATCH') throw new Error('Test placement requires an active match player.');
    const withinTestBounds = position.x >= 0 && position.x <= ARENA.width && position.y >= 0 && position.y <= ARENA.height;
    const facingLength = Math.hypot(facing.x, facing.y);
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !withinTestBounds ||
      !Number.isFinite(facingLength) || facingLength === 0) {
      throw new RangeError('Test placement requires bounded finite position and facing values.');
    }
    const normalizedFacing = { x: facing.x / facingLength, y: facing.y / facingLength };
    player.position = { x: position.x, y: position.y };
    player.velocity = { x: 0, y: 0 };
    player.facing = normalizedFacing;
    player.latestInput = {
      ...player.latestInput,
      moveX: 0,
      moveY: 0,
      aimX: normalizedFacing.x,
      aimY: normalizedFacing.y,
      quick: false,
      heavy: false,
      dash: false
    };
    player.previousQuick = false;
    player.previousHeavy = false;
    player.previousDash = false;
    room.inputs.delete(playerId);
    this.publishSnapshot(room);
  }

  private assertConnectionAvailable(connectionId: string): void {
    if (this.connections.has(connectionId)) {
      throw new DomainError('ALREADY_IN_ROOM', 'Bu bağlantı zaten bir odada.', true);
    }
  }

  private normalizeName(name: string): string {
    try {
      return normalizePlayerName(name);
    } catch {
      throw new DomainError('INVALID_NAME', 'Oyuncu adı 2–16 görünür karakter olmalıdır.', true);
    }
  }

  private requireRoom(roomCode: string): Room {
    let normalized: string;
    try {
      normalized = normalizeRoomCode(roomCode);
    } catch {
      throw new DomainError('INVALID_ROOM_CODE', 'Oda kodu geçersiz.', true);
    }
    const room = this.rooms.get(normalized);
    if (!room) throw new DomainError('ROOM_NOT_FOUND', 'Oda bulunamadı.', true);
    return room;
  }

  private parseResumeToken(value: string): Uint8Array {
    if (!/^[0-9a-f]{64}$/iu.test(value)) {
      throw new DomainError('INVALID_RESUME_TOKEN', 'Yeniden bağlanma anahtarı geçersiz veya süresi dolmuş.', true);
    }
    return Uint8Array.from(Buffer.from(value, 'hex'));
  }

  private requireConnectedPlayer(connectionId: string): { room: Room; player: RoomPlayer } {
    const session = this.connections.get(connectionId);
    const room = session ? this.rooms.get(session.roomCode) : undefined;
    const player = session ? room?.players.get(session.playerId) : undefined;
    if (!room || !player || !player.connected) {
      throw new DomainError('PLAYER_NOT_FOUND', 'Oyuncu oturumu bulunamadı.', true);
    }
    return { room, player };
  }

  private rememberResultPlayer(room: Room, player: RoomPlayer): void {
    if (!room.resultPlayers || room.resultPlayers.has(player.playerId)) return;
    room.resultPlayers.set(player.playerId, {
      playerId: player.playerId,
      name: player.name,
      chassis: player.chassis,
      accent: player.accent,
      stats: { ...(room.match?.players[player.playerId]?.stats ?? player.stats) },
      order: player.order,
      left: false
    });
  }

  private markResultPlayerLeft(room: Room, player: RoomPlayer): void {
    const resultPlayer = room.resultPlayers?.get(player.playerId);
    if (resultPlayer) resultPlayer.left = true;
  }

  private publishedResultPlayers(room: Room): readonly ResultPlayer[] {
    return [...(room.resultPlayers?.values() ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((resultPlayer) => {
        const livePlayer = room.players.get(resultPlayer.playerId);
        if (resultPlayer.left || !livePlayer) {
          return {
            playerId: resultPlayer.playerId,
            name: resultPlayer.name,
            chassis: resultPlayer.chassis,
            accent: resultPlayer.accent,
            ready: false,
            connected: false,
            reconnectRemainingMs: null,
            stats: { ...resultPlayer.stats },
            resultStatus: 'LEFT' as const
          };
        }
        return {
          playerId: resultPlayer.playerId,
          name: resultPlayer.name,
          chassis: resultPlayer.chassis,
          accent: resultPlayer.accent,
          ready: livePlayer.ready,
          connected: livePlayer.connected,
          reconnectRemainingMs: livePlayer.connected || livePlayer.expiresAt === null
            ? null
            : Math.max(0, livePlayer.expiresAt - this.deps.now()),
          stats: { ...resultPlayer.stats },
          resultStatus: livePlayer.ready ? 'READY' as const : 'WAITING' as const
        };
      });
  }

  private publishRoom(room: Room): void {
    const result = room.phase === 'RESULT' && room.match?.resultReason
      ? {
          winnerPlayerId: room.match.winnerPlayerId,
          reason: room.match.resultReason,
          players: this.publishedResultPlayers(room)
        }
      : null;
    this.deps.publish({
      type: 'ROOM_STATE',
      roomCode: room.roomCode,
      state: {
        roomCode: room.roomCode,
        phase: room.phase,
        hostPlayerId: room.hostPlayerId,
        pauseRemainingMs: room.match?.phase === 'PAUSED' ? this.pauseRemainingMs(room) : null,
        result,
        settings: { ...room.settings },
        players: this.orderedPlayers(room).map((player) => ({
          playerId: player.playerId,
          name: player.name,
          chassis: player.chassis,
          accent: player.accent,
          ready: player.ready,
          connected: player.connected,
          reconnectRemainingMs: player.connected || player.expiresAt === null
            ? null
            : Math.max(0, player.expiresAt - this.deps.now()),
          stats: { ...(room.match?.players[player.playerId]?.stats ?? player.stats) }
        }))
      }
    });
  }

  private snapshotForRoom(room: Room): MatchSnapshot {
    const network = Object.fromEntries(
      Object.keys(room.match!.players)
        .sort()
        .map((playerId) => [playerId, networkStatus(room.network.get(playerId) ?? createNetworkRuntime())])
    );
    const snapshot = snapshotMatch(room.match!, network);
    return {
      ...snapshot,
      network
    };
  }
}
