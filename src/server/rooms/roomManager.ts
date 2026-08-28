import type {
  GameEvent,
  InputFrame,
  MatchSnapshot,
  RoomState,
  SessionWelcome,
  Team
} from '../../shared/model.js';
import { GAME } from '../../shared/constants.js';
import { normalizePlayerName, normalizeRoomCode } from '../../shared/names.js';
import { timingSafeEqual } from 'node:crypto';
import { forceDelivery, setPlayerConnected, snapshotMatch, stepMatch } from '../game/simulation.js';
import { createMatchState, type MatchState } from '../game/state.js';
import { DomainError } from './domainError.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIMULATION_STEP_MS = 1_000 / GAME.tickRate;
const SNAPSHOT_INTERVAL_MS = 1_000 / GAME.snapshotRate;
const MAX_ELAPSED_MS = 250;
const MAX_STEPS_PER_ADVANCE = 5;
const TIMER_EPSILON_MS = 1e-7;

export type RoomPublication =
  | { type: 'ROOM_STATE'; roomCode: string; state: RoomState }
  | { type: 'MATCH_STARTED'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_SNAPSHOT'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_EVENT'; roomCode: string; event: GameEvent }
  | { type: 'ROOM_CLOSED'; roomCode: string };

type RoomPlayer = {
  playerId: string;
  name: string;
  team: Team;
  ready: boolean;
  connected: boolean;
  stats: { deliveries: number; tackles: number };
  resumeToken: Uint8Array;
  order: number;
  expiresAt: number | null;
};

type Room = {
  roomCode: string;
  phase: RoomState['phase'];
  hostPlayerId: string;
  players: Map<string, RoomPlayer>;
  nextPlayerOrder: number;
  nextTiedTeam: Team;
  match: MatchState | null;
  inputs: Map<string, InputFrame>;
  accumulatorMs: number;
  snapshotAccumulatorMs: number;
};

type ConnectionSession = Readonly<{ roomCode: string; playerId: string }>;

type RoomManagerDependencies = Readonly<{
  now: () => number;
  randomBytes: (size: number) => Uint8Array;
  publish: (event: RoomPublication) => void;
}>;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, ConnectionSession>();

  constructor(private readonly deps: RoomManagerDependencies) {}

  reset(): void {
    this.rooms.clear();
    this.connections.clear();
  }

  createRoom(connectionId: string, name: string): SessionWelcome {
    this.assertConnectionAvailable(connectionId);
    const roomCode = this.createRoomCode();
    const playerId = bytesToHex(this.deps.randomBytes(16));
    const normalizedName = this.normalizeName(name);
    const resumeToken = this.deps.randomBytes(32);
    const room: Room = {
      roomCode,
      phase: 'LOBBY',
      hostPlayerId: playerId,
      players: new Map([
        [
          playerId,
          {
            playerId,
            name: normalizedName,
            team: 'CYAN',
            ready: false,
            connected: true,
            stats: { deliveries: 0, tackles: 0 },
            resumeToken,
            order: 0,
            expiresAt: null
          }
        ]
      ]),
      nextPlayerOrder: 1,
      nextTiedTeam: 'AMBER',
      match: null,
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
    if (room.players.size >= GAME.maxPlayers) {
      throw new DomainError('ROOM_FULL', 'Oda dolu.', true);
    }
    const normalizedName = this.normalizeName(name);
    const playerId = bytesToHex(this.deps.randomBytes(16));
    const resumeToken = this.deps.randomBytes(32);
    const team = this.assignTeam(room);
    room.players.set(playerId, {
      playerId,
      name: normalizedName,
      team,
      ready: false,
      connected: true,
      stats: { deliveries: 0, tackles: 0 },
      resumeToken,
      order: room.nextPlayerOrder++,
      expiresAt: null
    });
    this.connections.set(connectionId, { roomCode: room.roomCode, playerId });
    this.publishRoom(room);
    return { playerId, roomCode: room.roomCode, resumeToken: bytesToHex(resumeToken), resumed: false };
  }

  resume(connectionId: string, roomCode: string, resumeToken: string): SessionWelcome {
    this.assertConnectionAvailable(connectionId);
    const room = this.requireRoom(roomCode);
    const token = this.parseResumeToken(resumeToken);
    const player = Array.from(room.players.values()).find(
      (candidate) =>
        !candidate.connected &&
        candidate.expiresAt !== null &&
        candidate.expiresAt > this.deps.now() &&
        candidate.resumeToken.byteLength === token.byteLength &&
        timingSafeEqual(candidate.resumeToken, token)
    );
    if (!player) {
      throw new DomainError('INVALID_RESUME_TOKEN', 'Yeniden bağlanma anahtarı geçersiz veya süresi dolmuş.', true);
    }
    player.connected = true;
    player.expiresAt = null;
    this.connections.set(connectionId, { roomCode: room.roomCode, playerId: player.playerId });
    if (!room.players.get(room.hostPlayerId)?.connected) this.migrateHost(room);
    if (room.match?.players[player.playerId]) {
      this.publishMatchEvents(room, setPlayerConnected(room.match, player.playerId, true));
      this.deps.publish({
        type: 'MATCH_SNAPSHOT',
        roomCode: room.roomCode,
        snapshot: snapshotMatch(room.match)
      });
    }
    this.publishRoom(room);
    return { playerId: player.playerId, roomCode: room.roomCode, resumeToken, resumed: true };
  }

  setTeam(connectionId: string, team: Team): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    if (player.team === team) return;
    const counts: Record<Team, number> = { CYAN: 0, AMBER: 0 };
    for (const candidate of room.players.values()) {
      if (candidate.connected && candidate.playerId !== player.playerId) counts[candidate.team] += 1;
    }
    counts[team] += 1;
    if (Math.abs(counts.CYAN - counts.AMBER) > 1) {
      throw new DomainError('UNBALANCED_TEAM', 'Takım değişikliği takımları dengesiz bırakır.', true);
    }
    player.team = team;
    player.ready = false;
    this.publishRoom(room);
  }

  setReady(connectionId: string, ready: boolean): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    player.ready = ready;
    this.publishRoom(room);
  }

  startMatch(connectionId: string): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'LOBBY' && room.phase !== 'RESULT') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    if (room.hostPlayerId !== player.playerId) {
      throw new DomainError('NOT_HOST', 'Bu işlemi yalnızca oda sahibi yapabilir.', true);
    }
    const connected = Array.from(room.players.values()).filter((candidate) => candidate.connected);
    if (connected.length < 2) {
      throw new DomainError('NOT_ENOUGH_PLAYERS', 'Maçı başlatmak için en az iki bağlı oyuncu gerekir.', true);
    }
    if (!connected.some((candidate) => candidate.team === 'CYAN') || !connected.some((candidate) => candidate.team === 'AMBER')) {
      throw new DomainError('UNBALANCED_TEAM', 'Her iki takımda da bağlı bir oyuncu olmalıdır.', true);
    }
    if (connected.some((candidate) => !candidate.ready)) {
      throw new DomainError('NOT_READY', 'Tüm bağlı oyuncular hazır olmalıdır.', true);
    }
    for (const candidate of room.players.values()) {
      candidate.ready = false;
      candidate.stats = { deliveries: 0, tackles: 0 };
    }
    room.match = createMatchState(
      Array.from(room.players.values()).map((candidate) => ({
        playerId: candidate.playerId,
        name: candidate.name,
        team: candidate.team,
        connected: candidate.connected
      })),
      this.deps.now()
    );
    room.phase = 'COUNTDOWN';
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    this.publishRoom(room);
    this.deps.publish({
      type: 'MATCH_STARTED',
      roomCode: room.roomCode,
      snapshot: snapshotMatch(room.match)
    });
  }

  applyInput(connectionId: string, input: InputFrame): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH')) {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    room.inputs.set(player.playerId, input);
  }

  setResultReady(connectionId: string, ready: boolean): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'RESULT') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    player.ready = ready;
    this.publishRoom(room);
  }

  returnToLobby(connectionId: string): void {
    const { room, player } = this.requireConnectedPlayer(connectionId);
    if (room.phase !== 'RESULT') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    if (room.hostPlayerId !== player.playerId) {
      throw new DomainError('NOT_HOST', 'Bu işlemi yalnızca oda sahibi yapabilir.', true);
    }
    room.phase = 'LOBBY';
    room.match = null;
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    for (const candidate of room.players.values()) candidate.ready = false;
    this.publishRoom(room);
  }

  deliverCore(roomCode: string, team: Team): void {
    const room = this.requireRoom(roomCode);
    if (!room.match || room.phase !== 'MATCH') {
      throw new DomainError('INVALID_PHASE', 'Bu işlem şu anda kullanılamaz.', true);
    }
    this.publishMatchEvents(room, forceDelivery(room.match, team));
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
    room.inputs.delete(player.playerId);
    if (room.match?.players[player.playerId]) {
      this.publishMatchEvents(room, setPlayerConnected(room.match, player.playerId, false));
    }
    if (room.hostPlayerId === player.playerId) this.migrateHost(room);
    this.publishRoom(room);
  }

  advance(elapsedMs: number): void {
    const now = this.deps.now();
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const player of room.players.values()) {
        if (!player.connected && player.expiresAt !== null && player.expiresAt <= now) {
          room.players.delete(player.playerId);
          changed = true;
        }
      }
      if (room.players.size === 0) {
        this.rooms.delete(room.roomCode);
        this.deps.publish({ type: 'ROOM_CLOSED', roomCode: room.roomCode });
        continue;
      }
      if (
        changed &&
        room.match &&
        (room.phase === 'COUNTDOWN' || room.phase === 'MATCH') &&
        room.players.size < 2
      ) {
        this.abortMatch(room);
      } else if (changed) {
        this.publishRoom(room);
      }

      if (!room.match || (room.phase !== 'COUNTDOWN' && room.phase !== 'MATCH')) continue;
      const clampedElapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(elapsedMs, MAX_ELAPSED_MS)) : 0;
      room.accumulatorMs += clampedElapsed;
      room.snapshotAccumulatorMs += clampedElapsed;
      let steps = 0;
      while (room.accumulatorMs + TIMER_EPSILON_MS >= SIMULATION_STEP_MS && steps < MAX_STEPS_PER_ADVANCE) {
        const events = stepMatch(room.match, room.inputs, SIMULATION_STEP_MS);
        room.accumulatorMs -= SIMULATION_STEP_MS;
        steps += 1;
        this.publishMatchEvents(room, events);
        if (room.match.phase === 'FINISHED') break;
        if (room.phase === 'COUNTDOWN' && room.match.phase === 'REGULATION') {
          room.phase = 'MATCH';
          this.publishRoom(room);
        }
      }
      if (Math.abs(room.accumulatorMs) < TIMER_EPSILON_MS) room.accumulatorMs = 0;
      if (steps === MAX_STEPS_PER_ADVANCE && room.accumulatorMs + TIMER_EPSILON_MS >= SIMULATION_STEP_MS) {
        room.accumulatorMs = 0;
      }
      while (room.snapshotAccumulatorMs + TIMER_EPSILON_MS >= SNAPSHOT_INTERVAL_MS) {
        room.snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;
        this.deps.publish({
          type: 'MATCH_SNAPSHOT',
          roomCode: room.roomCode,
          snapshot: snapshotMatch(room.match)
        });
      }
      if (Math.abs(room.snapshotAccumulatorMs) < TIMER_EPSILON_MS) room.snapshotAccumulatorMs = 0;
    }
  }

  private createRoomCode(): string {
    for (;;) {
      const roomCode = Array.from(this.deps.randomBytes(4), (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
      if (!this.rooms.has(roomCode)) return roomCode;
    }
  }

  private assignTeam(room: Room): Team {
    const counts: Record<Team, number> = { CYAN: 0, AMBER: 0 };
    for (const player of room.players.values()) {
      if (player.connected) counts[player.team] += 1;
    }
    if (counts.CYAN < counts.AMBER) return 'CYAN';
    if (counts.AMBER < counts.CYAN) return 'AMBER';
    const team = room.nextTiedTeam;
    room.nextTiedTeam = team === 'CYAN' ? 'AMBER' : 'CYAN';
    return team;
  }

  private migrateHost(room: Room): void {
    const successor = Array.from(room.players.values())
      .filter((player) => player.connected)
      .sort((left, right) => left.order - right.order)[0];
    if (successor) room.hostPlayerId = successor.playerId;
  }

  private publishMatchEvents(room: Room, events: readonly GameEvent[]): void {
    for (const event of events) {
      this.deps.publish({ type: 'MATCH_EVENT', roomCode: room.roomCode, event });
    }
    if (room.match?.phase === 'FINISHED' && room.phase !== 'RESULT') this.enterResult(room);
  }

  private enterResult(room: Room): void {
    if (!room.match) return;
    room.phase = 'RESULT';
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    for (const player of room.players.values()) {
      const matchPlayer = room.match.players[player.playerId];
      if (matchPlayer) player.stats = { ...matchPlayer.stats };
      player.ready = false;
    }
    this.publishRoom(room);
  }

  private abortMatch(room: Room): void {
    room.match = null;
    room.phase = 'LOBBY';
    room.inputs.clear();
    room.accumulatorMs = 0;
    room.snapshotAccumulatorMs = 0;
    for (const player of room.players.values()) {
      player.ready = false;
      player.stats = { deliveries: 0, tackles: 0 };
    }
    this.publishRoom(room);
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

  private publishRoom(room: Room): void {
    this.deps.publish({
      type: 'ROOM_STATE',
      roomCode: room.roomCode,
      state: {
        roomCode: room.roomCode,
        phase: room.phase,
        hostPlayerId: room.hostPlayerId,
        players: Array.from(room.players.values())
          .sort((left, right) => left.order - right.order)
          .map((player) => ({
            playerId: player.playerId,
            name: player.name,
            team: player.team,
            ready: player.ready,
            connected: player.connected,
            stats: { ...player.stats }
          }))
      }
    });
  }
}
