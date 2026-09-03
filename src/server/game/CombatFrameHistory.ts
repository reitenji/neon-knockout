import { GAME } from '../../shared/constants.js';
import type { Vec2 } from '../../shared/model.js';
import type { MatchState } from './state.js';

export type HistoricalPlayerFrame = Readonly<{
  playerId: string;
  position: Vec2;
  collisionRadius: number;
  connected: boolean;
  respawning: boolean;
  protected: boolean;
  dashInvulnerable: boolean;
}>;

export type CombatFrame = Readonly<{
  tick: number;
  players: Readonly<Record<string, HistoricalPlayerFrame>>;
}>;

const HISTORY_CAPACITY = 12;

function snapshotFrame(state: MatchState): CombatFrame {
  const players = Object.fromEntries(Object.keys(state.players).sort().map((playerId) => {
    const player = state.players[playerId];
    const position = Object.freeze({ ...player.position });
    const frame = Object.freeze({
      playerId,
      position,
      collisionRadius: GAME.collisionRadius,
      connected: player.connected,
      respawning: player.respawnRemainingMs > 0,
      protected: player.protectionRemainingMs > 0,
      dashInvulnerable: player.dashInvulnerabilityRemainingMs > 0
    });
    return [playerId, frame];
  }));
  return Object.freeze({ tick: state.tick, players: Object.freeze(players) });
}

export class CombatFrameHistory {
  private readonly frames: Array<CombatFrame | undefined> = Array(HISTORY_CAPACITY);
  private nextIndex = 0;
  private size = 0;

  capture(state: MatchState): void {
    const frame = snapshotFrame(state);
    const existingIndex = this.frames.findIndex((candidate) => candidate?.tick === state.tick);
    if (existingIndex >= 0) {
      this.frames[existingIndex] = frame;
      return;
    }
    this.frames[this.nextIndex] = frame;
    this.nextIndex = (this.nextIndex + 1) % HISTORY_CAPACITY;
    this.size = Math.min(HISTORY_CAPACITY, this.size + 1);
  }

  clear(): void {
    this.frames.fill(undefined);
    this.nextIndex = 0;
    this.size = 0;
  }

  latestTick(): number | null {
    return this.boundaryTick(Math.max);
  }

  oldestTick(): number | null {
    return this.boundaryTick(Math.min);
  }

  get(tick: number): CombatFrame | null {
    return this.frames.find((frame) => frame?.tick === tick) ?? null;
  }

  private boundaryTick(select: (...values: number[]) => number): number | null {
    if (this.size === 0) return null;
    return select(...this.frames.flatMap((frame) => frame ? [frame.tick] : []));
  }
}
