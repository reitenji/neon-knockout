import { GAME } from '../../shared/constants.js';
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

type PendingInput = Readonly<{ frame: InputFrame; elapsedMs: number }>;
type TimedSnapshot = Readonly<{ snapshot: MatchSnapshot; receivedAtMs: number }>;

function kinematicsOf(player: MatchPlayer): KinematicState {
  return { position: player.position, velocity: player.velocity, facing: player.facing };
}

function dashVelocity(frame: InputFrame, facing: Vec2): Vec2 | null {
  if (!frame.dash) return null;
  const movement = normalizeAxes(frame.moveX, frame.moveY);
  const direction = movement.x === 0 && movement.y === 0 ? facing : movement;
  return { x: direction.x * GAME.dashSpeed, y: direction.y * GAME.dashSpeed };
}

function advancePresentation(state: KinematicState, frame: InputFrame, elapsedMs: number): KinematicState {
  const facing = normalizeAim(frame.aimX, frame.aimY, state.facing);
  return advanceKinematics(state, frame, elapsedMs, {
    dashVelocity: dashVelocity(frame, facing),
    steeringScale: 1,
    voidPull: { x: 0, y: 0 }
  });
}

function blendPosition(current: Vec2, target: Vec2): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.hypot(dx, dy) >= LOCAL_CORRECTION_SNAP_DISTANCE) return target;
  return { x: current.x + dx * LOCAL_CORRECTION_BLEND, y: current.y + dy * LOCAL_CORRECTION_BLEND };
}

function quickActionStart(player: MatchPlayer, frame: InputFrame): MatchAction | null {
  if (!frame.quick || player.action.kind !== null || player.action.phase !== 'IDLE') return null;
  const comboStep: 1 | 2 | 3 = player.action.comboStep === 1 ? 2 : player.action.comboStep === 2 ? 3 : 1;
  const kind = comboStep === 1 ? 'QUICK_1' : comboStep === 2 ? 'QUICK_2' : 'QUICK_3';
  return { kind, phase: 'WINDUP', comboStep, chargeMs: 0 };
}

export class PredictionBuffer {
  private readonly pending: PendingInput[] = [];
  private display: KinematicState | null = null;
  private actionStart: MatchAction | null = null;
  private heavyChargeMs = 0;

  constructor(readonly playerId: string) {}

  predict(frame: InputFrame, player: MatchPlayer, elapsedMs: number): PlayerPresentation {
    const last = this.pending[this.pending.length - 1];
    if (!last || frame.seq > last.frame.seq) this.pending.push({ frame, elapsedMs });
    this.display = advancePresentation(this.display ?? kinematicsOf(player), frame, elapsedMs);
    if (player.action.kind !== null) this.heavyChargeMs = 0;
    if (frame.heavy && player.action.kind === null) {
      this.heavyChargeMs = Math.min(GAME.heavyMaxChargeMs, this.heavyChargeMs + elapsedMs);
    } else if (!frame.heavy && this.actionStart?.kind !== 'HEAVY') {
      this.heavyChargeMs = 0;
    }
    this.actionStart = quickActionStart(player, frame) ??
      (frame.dash && player.action.kind === null
        ? { kind: 'DASH', phase: 'ACTIVE', comboStep: 0, chargeMs: 0 }
        : frame.heavy && player.action.kind === null
          ? { kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: this.heavyChargeMs }
          : null);
    return { ...this.display, actionStart: this.actionStart };
  }

  reconcile(authoritativePlayer: MatchPlayer, fallbackElapsedMs: number): PlayerPresentation {
    while (
      this.pending.length > 0 &&
      (this.pending[0]?.frame.seq ?? Number.POSITIVE_INFINITY) <= authoritativePlayer.lastProcessedInputSeq
    ) this.pending.shift();

    let replay = kinematicsOf(authoritativePlayer);
    let replayedAction: MatchAction | null = null;
    let replayedChargeMs = authoritativePlayer.action.kind === null ? authoritativePlayer.action.chargeMs : 0;
    for (const pending of this.pending) {
      replay = advancePresentation(replay, pending.frame, pending.elapsedMs || fallbackElapsedMs);
      if (pending.frame.heavy && authoritativePlayer.action.kind === null) {
        replayedChargeMs = Math.min(GAME.heavyMaxChargeMs, replayedChargeMs + pending.elapsedMs);
        replayedAction = { kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: replayedChargeMs };
      } else {
        replayedAction = quickActionStart(authoritativePlayer, pending.frame) ?? replayedAction;
      }
    }
    const position = this.display ? blendPosition(this.display.position, replay.position) : replay.position;
    this.display = { ...replay, position };
    this.actionStart = authoritativePlayer.action.kind === null ? replayedAction : null;
    this.heavyChargeMs = replayedChargeMs;
    return { ...this.display, actionStart: this.actionStart };
  }

  pendingSequences(): number[] {
    return this.pending.map(({ frame }) => frame.seq);
  }

  reset(player?: MatchPlayer): void {
    this.pending.length = 0;
    this.display = player ? kinematicsOf(player) : null;
    this.actionStart = null;
    this.heavyChargeMs = 0;
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
