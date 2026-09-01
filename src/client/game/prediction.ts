import { ARENA, GAME } from '../../shared/constants.js';
import { advanceKinematics, normalizeAim, normalizeAxes, type KinematicState } from '../../shared/kinematics.js';
import type { InputFrame, MatchAction, MatchPlayer, MatchSnapshot, Vec2 } from '../../shared/model.js';

export const INTERPOLATION_DELAY_MS = 70;
export const REMOTE_SNAP_DISTANCE = 180;
export const LOCAL_CORRECTION_SNAP_DISTANCE = 160;
const LOCAL_CORRECTION_BLEND = 0.35;

export type PlayerPresentation = Readonly<KinematicState & { actionStart: MatchAction | null }>;

export type InterpolationFrame = Readonly<{
  previous: MatchSnapshot;
  current: MatchSnapshot;
  alpha: number;
}>;

type PendingInput = Readonly<{ frame: InputFrame; elapsedMs: number; platformProgress: number }>;
type TimedSnapshot = Readonly<{ snapshot: MatchSnapshot; receivedAtMs: number }>;
type PredictionRuntime = KinematicState & {
  dashRemainingMs: number;
  dashCooldownRemainingMs: number;
  dashDirection: Vec2;
  hitstunRemainingMs: number;
  respawnRemainingMs: number;
  action: MatchAction;
  heavyChargeMs: number;
  heavyHeld: boolean;
  heavyAim: Vec2;
};

const NEUTRAL_ACTION_METADATA = {
  charging: false,
  attackId: null,
  profileId: null,
  lockedFacing: null,
  activeProgress: 0,
  hitTargetIds: []
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function subtract(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function dot(left: Vec2, right: Vec2): number {
  return left.x * right.x + left.y * right.y;
}

function normalize(vector: Vec2, fallback: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.000001) return fallback;
  return { x: vector.x / length, y: vector.y / length };
}

function platformVertices(progress: number): readonly Vec2[] {
  const contraction = clamp(progress, 0, 1);
  return ARENA.regulationVertices.map((regulation, index) => {
    const minimum = ARENA.minimumVertices[index]!;
    return {
      x: regulation.x + (minimum.x - regulation.x) * contraction,
      y: regulation.y + (minimum.y - regulation.y) * contraction
    };
  });
}

function pointInConvexPolygon(point: Vec2, vertices: readonly Vec2[]): boolean {
  let direction = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    if (Math.abs(cross) <= 0.000000001) continue;
    const currentDirection = Math.sign(cross);
    if (direction !== 0 && currentDirection !== direction) return false;
    direction = currentDirection;
  }
  return true;
}

function closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared <= 0.000000001) return start;
  const projection = clamp(dot(subtract(point, start), segment) / lengthSquared, 0, 1);
  return { x: start.x + segment.x * projection, y: start.y + segment.y * projection };
}

function nearestOutwardNormal(point: Vec2, vertices: readonly Vec2[]): Vec2 {
  let nearestStart = vertices[0]!;
  let nearestEnd = vertices[1]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    const edgePoint = closestPointOnSegment(point, start, end);
    const distance = Math.hypot(point.x - edgePoint.x, point.y - edgePoint.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestStart = start;
      nearestEnd = end;
    }
  }
  const signedArea = vertices.reduce((total, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return total + vertex.x * next.y - next.x * vertex.y;
  }, 0);
  const edge = subtract(nearestEnd, nearestStart);
  return normalize(
    signedArea >= 0 ? { x: edge.y, y: -edge.x } : { x: -edge.y, y: edge.x },
    { x: 0, y: -1 }
  );
}

function runtimeOf(player: MatchPlayer): PredictionRuntime {
  const velocityDirection = normalize(player.velocity, player.facing);
  const lockedHeavyFacing = player.action.kind === 'HEAVY' && player.action.lockedFacing
    ? normalize(player.action.lockedFacing, player.facing)
    : null;
  return {
    position: player.position,
    velocity: player.velocity,
    facing: lockedHeavyFacing ?? player.facing,
    dashRemainingMs: player.dashRemainingMs,
    dashCooldownRemainingMs: player.dashCooldownRemainingMs,
    dashDirection: player.dashRemainingMs > 0 ? velocityDirection : player.facing,
    hitstunRemainingMs: player.hitstunRemainingMs,
    respawnRemainingMs: player.respawnRemainingMs,
    action: player.action,
    heavyChargeMs: player.action.kind === null ? player.action.chargeMs : 0,
    heavyHeld: player.action.kind === null && player.action.chargeMs > 0,
    heavyAim: lockedHeavyFacing ?? player.facing
  };
}

function dashDirection(frame: InputFrame, facing: Vec2): Vec2 {
  const movement = normalizeAxes(frame.moveX, frame.moveY);
  return movement.x === 0 && movement.y === 0 ? facing : movement;
}

function quickActionStart(player: MatchPlayer): MatchAction {
  const comboStep: 1 | 2 | 3 = player.action.comboStep === 1 ? 2 : player.action.comboStep === 2 ? 3 : 1;
  const kind = comboStep === 1 ? 'QUICK_1' : comboStep === 2 ? 'QUICK_2' : 'QUICK_3';
  return { kind, phase: 'WINDUP', comboStep, chargeMs: 0, ...NEUTRAL_ACTION_METADATA };
}

function advanceRuntime(
  runtime: PredictionRuntime,
  canonicalPlayer: MatchPlayer,
  frame: InputFrame,
  elapsedMs: number,
  platformProgress: number
): Readonly<{ runtime: PredictionRuntime; actionStart: MatchAction | null }> {
  const elapsed = Math.max(0, elapsedMs);
  if (runtime.action.kind === 'RESPAWNING' || runtime.respawnRemainingMs > 0) {
    return {
      runtime: { ...runtime, respawnRemainingMs: Math.max(0, runtime.respawnRemainingMs - elapsed) },
      actionStart: null
    };
  }

  let dashRemainingMs = Math.max(0, runtime.dashRemainingMs - elapsed);
  let dashCooldownRemainingMs = Math.max(0, runtime.dashCooldownRemainingMs - elapsed);
  const hitstunRemainingMs = Math.max(0, runtime.hitstunRemainingMs - elapsed);
  const committedAction = runtime.action.kind !== null && runtime.action.kind !== 'HITSTUN' &&
    runtime.action.kind !== 'DASH';
  const canStartAction = hitstunRemainingMs <= 0 && !committedAction && dashRemainingMs <= 0;
  let dashDirectionValue = runtime.dashDirection;
  let actionStart: MatchAction | null = null;
  let commitsAction = false;
  let heavyChargeMs = runtime.heavyChargeMs;
  const heavyRelease = runtime.heavyHeld && !frame.heavy;
  let heavyAim = runtime.heavyAim;

  if (!committedAction && (frame.heavy || heavyRelease)) {
    heavyAim = normalizeAim(frame.aimX, frame.aimY, heavyAim);
  }

  if (frame.dash && canStartAction) {
    heavyChargeMs = 0;
    if (dashCooldownRemainingMs <= 0) {
      dashDirectionValue = dashDirection(frame, runtime.facing);
      dashRemainingMs = GAME.dashDurationMs;
      dashCooldownRemainingMs = GAME.dashCooldownMs;
      actionStart = { kind: 'DASH', phase: 'ACTIVE', comboStep: 0, chargeMs: 0, ...NEUTRAL_ACTION_METADATA };
      commitsAction = true;
    }
  } else if (canStartAction && frame.heavy) {
    heavyChargeMs = Math.min(GAME.heavyMaxChargeMs, heavyChargeMs + elapsed);
    actionStart = {
      kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: heavyChargeMs,
      ...NEUTRAL_ACTION_METADATA, charging: true
    };
  } else if (canStartAction && heavyRelease && heavyChargeMs > 0) {
    actionStart = {
      kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: heavyChargeMs,
      ...NEUTRAL_ACTION_METADATA, lockedFacing: heavyAim
    };
    commitsAction = true;
  } else if (canStartAction && frame.quick && heavyChargeMs === 0) {
    actionStart = quickActionStart(canonicalPlayer);
    commitsAction = true;
  } else if (!frame.heavy) {
    heavyChargeMs = 0;
  }

  const vertices = platformVertices(platformProgress);
  const outsidePlatform = !pointInConvexPolygon(runtime.position, vertices);
  const charging = canStartAction && frame.heavy && heavyChargeMs > 0;
  const movementInput = hitstunRemainingMs > 0
    ? { ...frame, moveX: 0, moveY: 0 }
    : frame;
  const locksHeavyFacing = (runtime.action.kind === 'HEAVY' && !runtime.action.charging) ||
    (commitsAction && actionStart?.kind === 'HEAVY' && !actionStart.charging);
  const kinematicInput = locksHeavyFacing
    ? { ...movementInput, aimX: heavyAim.x, aimY: heavyAim.y }
    : movementInput;
  const next = advanceKinematics(runtime, kinematicInput, elapsed, {
    dashVelocity: dashRemainingMs > 0
      ? { x: dashDirectionValue.x * GAME.dashSpeed, y: dashDirectionValue.y * GAME.dashSpeed }
      : null,
    steeringScale:
      (outsidePlatform ? GAME.voidRecoverySteerMultiplier : 1) *
      (charging ? GAME.heavyChargeMoveMultiplier : 1),
    voidPull: outsidePlatform
      ? (() => {
          const normal = nearestOutwardNormal(runtime.position, vertices);
          return { x: normal.x * GAME.voidPullAcceleration, y: normal.y * GAME.voidPullAcceleration };
        })()
      : { x: 0, y: 0 }
  });

  return {
    runtime: {
      ...next,
      dashRemainingMs,
      dashCooldownRemainingMs,
      dashDirection: dashDirectionValue,
      hitstunRemainingMs,
      respawnRemainingMs: runtime.respawnRemainingMs,
      action: commitsAction && actionStart ? actionStart : runtime.action,
      heavyChargeMs,
      heavyHeld: frame.heavy,
      heavyAim
    },
    actionStart
  };
}

function blendPosition(current: Vec2, target: Vec2): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.hypot(dx, dy) >= LOCAL_CORRECTION_SNAP_DISTANCE) return target;
  return { x: current.x + dx * LOCAL_CORRECTION_BLEND, y: current.y + dy * LOCAL_CORRECTION_BLEND };
}

export class PredictionBuffer {
  private readonly pending: PendingInput[] = [];
  private runtime: PredictionRuntime | null = null;
  private actionStart: MatchAction | null = null;
  private lastPresentedAttackId: number | null = null;

  constructor(readonly playerId: string) {}

  predict(
    frame: InputFrame,
    player: MatchPlayer,
    elapsedMs: number,
    platformProgress = 0
  ): PlayerPresentation {
    const last = this.pending[this.pending.length - 1];
    if (!last || frame.seq > last.frame.seq) this.pending.push({ frame, elapsedMs, platformProgress });
    const advanced = advanceRuntime(this.runtime ?? runtimeOf(player), player, frame, elapsedMs, platformProgress);
    this.runtime = advanced.runtime;
    this.actionStart = advanced.actionStart;
    return { position: this.runtime.position, velocity: this.runtime.velocity, facing: this.runtime.facing, actionStart: this.actionStart };
  }

  reconcile(
    authoritativePlayer: MatchPlayer,
    fallbackElapsedMs: number,
    platformProgress = 0
  ): PlayerPresentation {
    while (
      this.pending.length > 0 &&
      (this.pending[0]?.frame.seq ?? Number.POSITIVE_INFINITY) <= authoritativePlayer.lastProcessedInputSeq
    ) this.pending.shift();

    let replay = runtimeOf(authoritativePlayer);
    let replayedAction: MatchAction | null = null;
    for (const pending of this.pending) {
      const advanced = advanceRuntime(
        replay,
        authoritativePlayer,
        pending.frame,
        pending.elapsedMs || fallbackElapsedMs,
        pending.platformProgress ?? platformProgress
      );
      replay = advanced.runtime;
      replayedAction = advanced.actionStart;
    }
    const position = this.runtime ? blendPosition(this.runtime.position, replay.position) : replay.position;
    this.runtime = { ...replay, position };
    const authoritativeAttackId = authoritativePlayer.action.attackId;
    if (authoritativeAttackId !== null && authoritativeAttackId !== this.lastPresentedAttackId) {
      this.lastPresentedAttackId = authoritativeAttackId;
      this.actionStart = authoritativePlayer.action;
    } else {
      this.actionStart = authoritativePlayer.action.kind === null ? replayedAction : null;
    }
    return { position, velocity: replay.velocity, facing: replay.facing, actionStart: this.actionStart };
  }

  pendingSequences(): number[] {
    return this.pending.map(({ frame }) => frame.seq);
  }

  reset(player?: MatchPlayer): void {
    this.pending.length = 0;
    this.runtime = player ? runtimeOf(player) : null;
    this.actionStart = null;
    this.lastPresentedAttackId = null;
  }
}

export class SnapshotTimeline {
  private readonly samples: TimedSnapshot[] = [];

  push(snapshot: MatchSnapshot, receivedAtMs: number): void {
    const last = this.samples[this.samples.length - 1];
    const timestamp = last ? Math.max(receivedAtMs, last.receivedAtMs) : receivedAtMs;
    this.samples.push({ snapshot, receivedAtMs: timestamp });
    if (this.samples.length > 8) this.samples.shift();
  }

  sample(renderNowMs: number): InterpolationFrame | null {
    if (this.samples.length === 0) return null;
    const targetTime = renderNowMs - INTERPOLATION_DELAY_MS;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    if (targetTime <= first.receivedAtMs) return { previous: first.snapshot, current: first.snapshot, alpha: 1 };

    for (let index = 1; index < this.samples.length; index += 1) {
      const current = this.samples[index]!;
      if (targetTime > current.receivedAtMs) continue;
      const previous = this.samples[index - 1]!;
      const duration = Math.max(1, current.receivedAtMs - previous.receivedAtMs);
      return {
        previous: previous.snapshot,
        current: current.snapshot,
        alpha: Math.max(0, Math.min(1, (targetTime - previous.receivedAtMs) / duration))
      };
    }
    return { previous: last.snapshot, current: last.snapshot, alpha: 1 };
  }

  clear(): void {
    this.samples.length = 0;
  }
}

export function interpolateRemotePlayer(
  previous: MatchPlayer,
  current: MatchPlayer,
  alpha: number,
  snapDistance = REMOTE_SNAP_DISTANCE
): Vec2 {
  const dx = current.position.x - previous.position.x;
  const dy = current.position.y - previous.position.y;
  if (Math.hypot(dx, dy) > snapDistance) return current.position;
  const progress = Math.max(0, Math.min(1, alpha));
  return { x: previous.position.x + dx * progress, y: previous.position.y + dy * progress };
}
