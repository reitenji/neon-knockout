import type { InputFrame, MatchPhase, Team, Vec2 } from '../../shared/model.js';
import { ARENA, GAME } from '../../shared/constants.js';

const compareStableIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export type MatchPlayerSeed = Readonly<{
  playerId: string;
  name: string;
  team: Team;
  connected?: boolean;
}>;

export type MutableMatchPlayer = {
  playerId: string;
  name: string;
  team: Team;
  position: Vec2;
  carriedCoreId: string | null;
  lastProcessedInputSeq: number;
  dashRemainingMs: number;
  dashCooldownRemainingMs: number;
  stunRemainingMs: number;
  stunnedTick: number | null;
  stats: { deliveries: number; tackles: number };
  connected: boolean;
  latestInput: InputFrame;
  previousDashPressed: boolean;
  tackledPlayerIds: Set<string>;
};

export type MutableMatchCore = {
  coreId: string;
  position: Vec2;
  carrierId: string | null;
  golden: boolean;
  padIndex: number | null;
  blockedPlayerId: string | null;
  blockedRemainingMs: number;
  looseRemainingMs: number;
  droppedTick: number | null;
};

export type MatchPadState = {
  padIndex: number;
  coreId: string;
  respawnRemainingMs: number | null;
};

export type MatchState = {
  tick: number;
  seed: number;
  phase: MatchPhase;
  pausedPhase: Exclude<MatchPhase, 'PAUSED' | 'FINISHED'> | null;
  countdownRemainingMs: number;
  remainingMs: number;
  score: Record<Team, number>;
  players: Record<string, MutableMatchPlayer>;
  cores: Record<string, MutableMatchCore>;
  pads: MatchPadState[];
  winner: Team | null;
};

export function createMatchState(playerSeeds: readonly MatchPlayerSeed[], seed: number): MatchState {
  const players: Record<string, MutableMatchPlayer> = {};
  const teamCounts: Record<Team, number> = { CYAN: 0, AMBER: 0 };
  const spawnOffset = (Math.trunc(seed) >>> 0) % ARENA.spawns.CYAN.length;

  for (const playerSeed of [...playerSeeds].sort((left, right) => compareStableIds(left.playerId, right.playerId))) {
    const spawnIndex = (spawnOffset + teamCounts[playerSeed.team]) % ARENA.spawns[playerSeed.team].length;
    teamCounts[playerSeed.team] += 1;
    players[playerSeed.playerId] = {
      playerId: playerSeed.playerId,
      name: playerSeed.name,
      team: playerSeed.team,
      position: ARENA.spawns[playerSeed.team][spawnIndex],
      carriedCoreId: null,
      lastProcessedInputSeq: -1,
      dashRemainingMs: 0,
      dashCooldownRemainingMs: 0,
      stunRemainingMs: 0,
      stunnedTick: null,
      stats: { deliveries: 0, tackles: 0 },
      connected: playerSeed.connected ?? true,
      latestInput: {
        seq: -1,
        up: false,
        down: false,
        left: false,
        right: false,
        dash: false
      },
      previousDashPressed: false,
      tackledPlayerIds: new Set()
    };
  }

  const connectedCount = Object.values(players).filter((player) => player.connected).length;
  const activePadIndices = connectedCount >= 6 ? [0, 1, 2] : connectedCount >= 4 ? [0, 2] : [1];
  const pads: MatchPadState[] = activePadIndices.map((padIndex, index) => ({
    padIndex,
    coreId: `core-${index + 1}`,
    respawnRemainingMs: null
  }));
  const cores: Record<string, MutableMatchCore> = Object.fromEntries(
    pads.map((pad) => [
      pad.coreId,
      {
        coreId: pad.coreId,
        position: ARENA.corePads[pad.padIndex],
        carrierId: null,
        golden: false,
        padIndex: pad.padIndex,
        blockedPlayerId: null,
        blockedRemainingMs: 0,
        looseRemainingMs: GAME.coreReturnMs,
        droppedTick: null
      }
    ])
  );

  return {
    tick: 0,
    seed,
    phase: 'COUNTDOWN',
    pausedPhase: null,
    countdownRemainingMs: 3_000,
    remainingMs: GAME.matchMs,
    score: { CYAN: 0, AMBER: 0 },
    players,
    cores,
    pads,
    winner: null
  };
}
