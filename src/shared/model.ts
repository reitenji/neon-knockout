export type Team = 'CYAN' | 'AMBER';

export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'MATCH' | 'RESULT';

export type MatchPhase = 'COUNTDOWN' | 'REGULATION' | 'PAUSED' | 'SUDDEN_DEATH' | 'FINISHED';

export type Vec2 = Readonly<{ x: number; y: number }>;

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type InputFrame = Readonly<{
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dash: boolean;
}>;

export type PlayerStats = Readonly<{ deliveries: number; tackles: number }>;

export type RoomPlayer = Readonly<{
  playerId: string;
  name: string;
  team: Team;
  ready: boolean;
  connected: boolean;
  stats: PlayerStats;
}>;

export type RoomState = Readonly<{
  roomCode: string;
  phase: RoomPhase;
  hostPlayerId: string;
  players: readonly RoomPlayer[];
}>;

export type MatchPlayer = Readonly<{
  playerId: string;
  name: string;
  team: Team;
  position: Vec2;
  carriedCoreId: string | null;
  lastProcessedInputSeq: number;
  dashRemainingMs: number;
  stunRemainingMs: number;
  stats: PlayerStats;
}>;

export type MatchCore = Readonly<{
  coreId: string;
  position: Vec2;
  carrierId: string | null;
  golden: boolean;
}>;

export type Score = Readonly<Record<Team, number>>;

export type MatchSnapshot = Readonly<{
  tick: number;
  phase: MatchPhase;
  remainingMs: number;
  score: Score;
  players: readonly MatchPlayer[];
  cores: readonly MatchCore[];
  winner: Team | null;
}>;

export type GameEvent =
  | Readonly<{ type: 'PICKUP'; playerId: string; coreId: string }>
  | Readonly<{ type: 'DROP'; playerId: string; coreId: string; position: Vec2 }>
  | Readonly<{ type: 'TACKLE'; attackerId: string; targetPlayerId: string; coreId: string }>
  | Readonly<{ type: 'SCORE'; team: Team; playerId: string; coreId: string; score: Score }>
  | Readonly<{ type: 'PHASE'; phase: MatchPhase }>
  | Readonly<{ type: 'RESULT'; winner: Team | null; score: Score }>;

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
