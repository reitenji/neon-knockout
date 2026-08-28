export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'MATCH' | 'RESULT';

export type MatchPhase = 'COUNTDOWN' | 'REGULATION' | 'PAUSED' | 'SUDDEN_DEATH' | 'FINISHED';

export type MatchResultReason = 'TARGET_SCORE' | 'TIME' | 'SUDDEN_DEATH' | 'NO_CONTEST';

export type Chassis = 'RIFT' | 'BASTION' | 'PULSE' | 'WRAITH';

export type AttackKind = 'QUICK_1' | 'QUICK_2' | 'QUICK_3' | 'HEAVY';

export type AttackPhase = 'IDLE' | 'WINDUP' | 'ACTIVE' | 'RECOVERY';

export type Vec2 = Readonly<{ x: number; y: number }>;

export type Polygon = readonly Vec2[];

export type CombatInputFrame = Readonly<{
  seq: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  quick: boolean;
  heavy: boolean;
  dash: boolean;
}>;

export type InputFrame = CombatInputFrame;

export type PlayerStats = Readonly<{
  knockouts: number;
  falls: number;
  landedHits: number;
  attackAttempts: number;
  attackHits: number;
}>;

export type RoomPlayer = Readonly<{
  playerId: string;
  name: string;
  chassis: Chassis;
  accentIndex: number;
  ready: boolean;
  resultReady: boolean;
  connected: boolean;
  reconnectRemainingMs: number | null;
  score: number;
  stats: PlayerStats;
}>;

export type RoomState = Readonly<{
  roomCode: string;
  phase: RoomPhase;
  hostPlayerId: string;
  pauseRemainingMs: number | null;
  result:
    | Readonly<{
        winnerPlayerId: string | null;
        reason: MatchResultReason;
      }>
    | null;
  players: readonly RoomPlayer[];
}>;

export type MatchPlayer = Readonly<{
  playerId: string;
  name: string;
  chassis: Chassis;
  accentIndex: number;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  overload: number;
  score: number;
  comboStep: 0 | 1 | 2 | 3;
  attackKind: AttackKind | null;
  attackPhase: AttackPhase;
  attackPhaseRemainingMs: number;
  chargeMs: number;
  dashRemainingMs: number;
  dashCooldownRemainingMs: number;
  hitstunRemainingMs: number;
  respawnRemainingMs: number;
  invulnerableRemainingMs: number;
  lastProcessedInputSeq: number;
  connected: boolean;
  stats: PlayerStats;
}>;

export type MatchSnapshot = Readonly<{
  tick: number;
  phase: MatchPhase;
  remainingMs: number;
  pauseRemainingMs: number | null;
  contraction: number;
  players: readonly MatchPlayer[];
  winnerPlayerId: string | null;
  resultReason: MatchResultReason | null;
}>;

export type MatchEvent =
  | Readonly<{
      type: 'HIT';
      attackerId: string;
      targetId: string;
      attack: AttackKind;
      impactPosition: Vec2;
      impulse: number;
      overload: number;
      tick: number;
    }>
  | Readonly<{
      type: 'KNOCKOUT';
      attackerId: string | null;
      targetId: string;
      scoreAwardedTo: string | null;
      score: Readonly<Record<string, number>>;
      tick: number;
    }>
  | Readonly<{
      type: 'RESPAWN';
      playerId: string;
      position: Vec2;
      tick: number;
    }>
  | Readonly<{
      type: 'PHASE';
      phase: MatchPhase;
      remainingMs: number;
      tick: number;
    }>
  | Readonly<{
      type: 'RESULT';
      winnerPlayerId: string | null;
      reason: MatchResultReason;
      score: Readonly<Record<string, number>>;
      tick: number;
    }>;

export type GameEvent = MatchEvent;

export type SessionWelcome = Readonly<{
  playerId: string;
  roomCode: string;
  resumeToken: string;
  resumed: boolean;
}>;

export type ServerError = Readonly<{
  code: string;
  message: string;
  recoverable: boolean;
}>;

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServerError };
