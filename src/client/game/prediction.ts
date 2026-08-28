import { ARENA, GAME } from '../../shared/constants.js';
import type { InputFrame, MatchCore, MatchPlayer, MatchSnapshot, Rect, Vec2 } from '../../shared/model.js';

export const INTERPOLATION_DELAY_MS = 100;
export const CORRECTION_BLEND = 0.35;
export const CORRECTION_SNAP_DISTANCE = 140;

type PredictionRuntime = {
  position: Vec2;
  dashRemainingMs: number;
  dashCooldownRemainingMs: number;
  stunRemainingMs: number;
  carrying: boolean;
};

export type InterpolationFrame = Readonly<{
  previous: MatchSnapshot;
  current: MatchSnapshot;
  alpha: number;
}>;

type TimedSnapshot = {
  snapshot: MatchSnapshot;
  receivedAtMs: number;
};

function circleIntersectsRect(position: Vec2, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(position.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(position.y, rect.y + rect.height));
  const dx = position.x - nearestX;
  const dy = position.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function pushThroughArena(position: Vec2, directionX: number, directionY: number, distance: number): Vec2 {
  const length = Math.hypot(directionX, directionY);
  if (length === 0 || distance <= 0) return position;

  const unitX = directionX / length;
  const unitY = directionY / length;
  let x = position.x;
  let y = position.y;
  let remaining = distance;

  while (remaining > 0) {
    const step = Math.min(1, remaining);
    const next = { x: x + unitX * step, y: y + unitY * step };
    if (
      next.x < GAME.playerRadius ||
      next.x > ARENA.width - GAME.playerRadius ||
      next.y < GAME.playerRadius ||
      next.y > ARENA.height - GAME.playerRadius
    ) {
      break;
    }

    let blocked = false;
    for (const obstacle of ARENA.obstacles) {
      if (circleIntersectsRect(next, GAME.playerRadius, obstacle)) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    x = next.x;
    y = next.y;
    remaining -= step;
  }

  return { x, y };
}

function createRuntime(player: MatchPlayer, position: Vec2 = player.position): PredictionRuntime {
  return {
    position,
    dashRemainingMs: player.dashRemainingMs,
    dashCooldownRemainingMs: player.dashCooldownRemainingMs,
    stunRemainingMs: player.stunRemainingMs,
    carrying: player.carriedCoreId !== null
  };
}

function advanceRuntime(runtime: PredictionRuntime, frame: InputFrame, elapsedMs: number): PredictionRuntime {
  let dashRemainingMs = runtime.dashRemainingMs;
  let dashCooldownRemainingMs = runtime.dashCooldownRemainingMs;
  if (frame.dash && dashRemainingMs <= 0 && dashCooldownRemainingMs <= 0) {
    dashRemainingMs = GAME.dashMs;
    dashCooldownRemainingMs = GAME.dashCooldownMs;
  }

  let position = runtime.position;
  if (runtime.stunRemainingMs <= 0) {
    const directionX = Number(frame.right) - Number(frame.left);
    const directionY = Number(frame.down) - Number(frame.up);
    const directionLength = Math.hypot(directionX, directionY);
    if (directionLength > 0) {
      const speed =
        GAME.moveSpeed *
        (runtime.carrying ? GAME.carrierMultiplier : 1) *
        (dashRemainingMs > 0 ? GAME.dashMultiplier : 1);
      position = pushThroughArena(position, directionX, directionY, speed * (elapsedMs / 1_000));
    }
  }

  return {
    position,
    dashRemainingMs: Math.max(0, dashRemainingMs - elapsedMs),
    dashCooldownRemainingMs: Math.max(0, dashCooldownRemainingMs - elapsedMs),
    stunRemainingMs: Math.max(0, runtime.stunRemainingMs - elapsedMs),
    carrying: runtime.carrying
  };
}

export function predictInputPosition(player: MatchPlayer, frame: InputFrame, elapsedMs: number): Vec2 {
  return advanceRuntime(createRuntime(player), frame, elapsedMs).position;
}

export function blendPredictedPosition(
  current: Vec2,
  target: Vec2,
  blend = CORRECTION_BLEND,
  snapDistance = CORRECTION_SNAP_DISTANCE
): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.hypot(dx, dy) >= snapDistance) return target;
  return { x: current.x + dx * blend, y: current.y + dy * blend };
}

export class PredictionBuffer {
  private readonly pending: InputFrame[] = [];
  private displayPosition: Vec2 | null = null;
  private runtime: PredictionRuntime | null = null;

  constructor(readonly playerId: string) {}

  push(frame: InputFrame): void {
    const last = this.pending[this.pending.length - 1];
    if (last && frame.seq <= last.seq) return;
    this.pending.push(frame);
  }

  predict(frame: InputFrame, player: MatchPlayer, elapsedMs: number): Vec2 {
    this.push(frame);
    if (!this.runtime) this.runtime = createRuntime(player, this.displayPosition ?? player.position);
    this.runtime.carrying = player.carriedCoreId !== null;
    this.runtime = advanceRuntime(this.runtime, frame, elapsedMs);
    this.displayPosition = this.runtime.position;
    return this.displayPosition;
  }

  reconcile(authoritativePlayer: MatchPlayer, elapsedMs: number): Vec2 {
    while (
      this.pending.length > 0 &&
      (this.pending[0]?.seq ?? Number.POSITIVE_INFINITY) <= authoritativePlayer.lastProcessedInputSeq
    ) {
      this.pending.shift();
    }

    let replay = createRuntime(authoritativePlayer);
    for (const frame of this.pending) replay = advanceRuntime(replay, frame, elapsedMs);
    const target = replay.position;
    this.displayPosition = this.displayPosition
      ? blendPredictedPosition(this.displayPosition, target)
      : target;
    this.runtime = { ...replay, position: this.displayPosition };
    return this.displayPosition;
  }

  pendingSequences(): number[] {
    return this.pending.map((frame) => frame.seq);
  }

  reset(player?: MatchPlayer): void {
    this.pending.length = 0;
    this.displayPosition = player?.position ?? null;
    this.runtime = player ? createRuntime(player) : null;
  }
}

export class SnapshotTimeline {
  private readonly samples: TimedSnapshot[] = [];
  private readonly frame: { previous: MatchSnapshot | null; current: MatchSnapshot | null; alpha: number } = {
    previous: null,
    current: null,
    alpha: 1
  };

  push(snapshot: MatchSnapshot, receivedAtMs: number): void {
    const last = this.samples[this.samples.length - 1];
    const timestamp = last ? Math.max(receivedAtMs, last.receivedAtMs) : receivedAtMs;
    this.samples.push({ snapshot, receivedAtMs: timestamp });
    if (this.samples.length > 8) this.samples.shift();
  }

  sample(renderNowMs: number): InterpolationFrame | null {
    if (this.samples.length === 0) return null;
    const targetTime = renderNowMs - INTERPOLATION_DELAY_MS;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];

    if (targetTime <= first.receivedAtMs) {
      this.frame.previous = first.snapshot;
      this.frame.current = first.snapshot;
      this.frame.alpha = 1;
      return this.frame as InterpolationFrame;
    }

    for (let index = 1; index < this.samples.length; index += 1) {
      const current = this.samples[index];
      if (targetTime > current.receivedAtMs) continue;
      const previous = this.samples[index - 1];
      const duration = Math.max(1, current.receivedAtMs - previous.receivedAtMs);
      this.frame.previous = previous.snapshot;
      this.frame.current = current.snapshot;
      this.frame.alpha = Math.max(0, Math.min(1, (targetTime - previous.receivedAtMs) / duration));
      return this.frame as InterpolationFrame;
    }

    this.frame.previous = last.snapshot;
    this.frame.current = last.snapshot;
    this.frame.alpha = 1;
    return this.frame as InterpolationFrame;
  }

  reset(): void {
    this.samples.length = 0;
    this.frame.previous = null;
    this.frame.current = null;
    this.frame.alpha = 1;
  }
}

function findPlayer(snapshotValue: MatchSnapshot, playerId: string): MatchPlayer | undefined {
  for (const candidate of snapshotValue.players) {
    if (candidate.playerId === playerId) return candidate;
  }
  return undefined;
}

function findCore(snapshotValue: MatchSnapshot, coreId: string): MatchCore | undefined {
  for (const candidate of snapshotValue.cores) {
    if (candidate.coreId === coreId) return candidate;
  }
  return undefined;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function interpolateSnapshot(
  previous: MatchSnapshot,
  current: MatchSnapshot,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2
): MatchSnapshot {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return {
    ...current,
    players: current.players.map((entry) => {
      if (entry.playerId === localPlayerId) return { ...entry, position: predictedLocalPosition };
      const older = findPlayer(previous, entry.playerId);
      if (!older) return entry;
      return {
        ...entry,
        position: {
          x: lerp(older.position.x, entry.position.x, clampedAlpha),
          y: lerp(older.position.y, entry.position.y, clampedAlpha)
        }
      };
    }),
    cores: current.cores.map((entry) => {
      const older = findCore(previous, entry.coreId);
      if (!older || older.carrierId !== entry.carrierId) return entry;
      return {
        ...entry,
        position: {
          x: lerp(older.position.x, entry.position.x, clampedAlpha),
          y: lerp(older.position.y, entry.position.y, clampedAlpha)
        }
      };
    })
  };
}
