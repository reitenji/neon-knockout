import { ARENA, CHASSIS, GAME } from '../../shared/constants.js';
import type {
  AttackKind,
  AttackPhase,
  Chassis,
  InputFrame,
  MatchPhase,
  MatchResultReason,
  PlayerAccent,
  Vec2
} from '../../shared/model.js';
import type { RoomSettings } from '../../shared/roomSettings.js';
import type { AttackProfileId } from '../../shared/combat/profiles.js';

const compareStableIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export type MatchPlayerSeed = Readonly<{
  playerId: string;
  name: string;
  chassis?: Chassis;
  accent: PlayerAccent;
  connected?: boolean;
}>;

export type MutablePlayerStats = {
  knockouts: number;
  falls: number;
  landedHits: number;
  completedAttacks: number;
};

export type AttackRuntime = {
  attackId: number;
  kind: AttackKind;
  profileId: AttackProfileId;
  phase: AttackPhase;
  phaseRemainingMs: number;
  phaseElapsedMs: number;
  previousActiveProgress: number;
  lockedFacing: Vec2;
  chargeMs: number;
  hitPlayerIds: Set<string>;
  resolvedPlayerIds: Set<string>;
};

export type PulseRuntime = {
  projectileId: number;
  ownerPlayerId: string;
  originatingAttackId: number;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  radius: number;
  remainingMs: number;
  hitPlayerIds: Set<string>;
};

export type MutableMatchPlayer = {
  playerId: string;
  name: string;
  chassis: Chassis;
  accent: PlayerAccent;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  overload: number;
  comboStep: 0 | 1 | 2 | 3;
  attack: AttackRuntime | null;
  chargeMs: number;
  charging: boolean;
  perfectDodgeConsumed: boolean;
  dashRemainingMs: number;
  dashInvulnerabilityRemainingMs: number;
  dashCooldownRemainingMs: number;
  dashDirection: Vec2;
  hitstunRemainingMs: number;
  respawnRemainingMs: number;
  resetOverloadOnRespawn: boolean;
  protectionRemainingMs: number;
  connected: boolean;
  lastProcessedInputSeq: number;
  latestInput: InputFrame;
  previousQuick: boolean;
  previousHeavy: boolean;
  previousDash: boolean;
  bufferedQuick: boolean;
  lastAttackerId: string | null;
  lastAttackerAtMs: number | null;
  stats: MutablePlayerStats;
};

export type MatchState = {
  tick: number;
  nextEventId: number;
  nextAttackId: number;
  nextProjectileId: number;
  seed: number;
  nowMs: number;
  phase: MatchPhase;
  pausedPhase: Exclude<MatchPhase, 'PAUSED' | 'FINISHED'> | null;
  countdownRemainingMs: number;
  remainingMs: number;
  pauseRemainingMs: number | null;
  contraction: number;
  readonly settings: RoomSettings;
  scores: Record<string, number>;
  winnerPlayerId: string | null;
  resultReason: MatchResultReason | null;
  players: Record<string, MutableMatchPlayer>;
  pulses: Record<number, PulseRuntime>;
};

export function createEmptyInput(): InputFrame {
  return {
    seq: -1,
    viewTick: 0,
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    quick: false,
    heavy: false,
    dash: false
  };
}

export function createPlayerStats(): MutablePlayerStats {
  return {
    knockouts: 0,
    falls: 0,
    landedHits: 0,
    completedAttacks: 0
  };
}

export function createMatchState(
  playerSeeds: readonly MatchPlayerSeed[],
  seed: number,
  settings: RoomSettings
): MatchState {
  const sortedSeeds = [...playerSeeds].sort((left, right) => compareStableIds(left.playerId, right.playerId));
  const players: Record<string, MutableMatchPlayer> = {};
  const scores: Record<string, number> = {};

  sortedSeeds.forEach((playerSeed, index) => {
    const anchor = ARENA.spawnAnchors[index % ARENA.spawnAnchors.length];
    players[playerSeed.playerId] = {
      playerId: playerSeed.playerId,
      name: playerSeed.name,
      chassis: playerSeed.chassis ?? CHASSIS[index % CHASSIS.length],
      accent: playerSeed.accent,
      position: anchor,
      velocity: { x: 0, y: 0 },
      facing: { x: 1, y: 0 },
      overload: 0,
      comboStep: 0,
      attack: null,
      chargeMs: 0,
      charging: false,
      perfectDodgeConsumed: false,
      dashRemainingMs: 0,
      dashInvulnerabilityRemainingMs: 0,
      dashCooldownRemainingMs: 0,
      dashDirection: { x: 1, y: 0 },
      hitstunRemainingMs: 0,
      respawnRemainingMs: 0,
      resetOverloadOnRespawn: false,
      protectionRemainingMs: 0,
      connected: playerSeed.connected ?? true,
      lastProcessedInputSeq: -1,
      latestInput: createEmptyInput(),
      previousQuick: false,
      previousHeavy: false,
      previousDash: false,
      bufferedQuick: false,
      lastAttackerId: null,
      lastAttackerAtMs: null,
      stats: { ...createPlayerStats() }
    };
    scores[playerSeed.playerId] = 0;
  });

  return {
    tick: 0,
    nextEventId: 1,
    nextAttackId: 1,
    nextProjectileId: 1,
    seed,
    nowMs: seed,
    phase: 'COUNTDOWN',
    pausedPhase: null,
    countdownRemainingMs: GAME.countdownMs,
    remainingMs: settings.durationMs,
    pauseRemainingMs: null,
    contraction: 0,
    settings: Object.freeze({ ...settings }),
    scores,
    winnerPlayerId: null,
    resultReason: null,
    players,
    pulses: {}
  };
}
