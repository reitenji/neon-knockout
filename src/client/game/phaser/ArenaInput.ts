import type Phaser from 'phaser';
import { GAME } from '../../../shared/constants.js';
import { normalizeAxes } from '../../../shared/kinematics.js';
import type { InputFrame, Vec2 } from '../../../shared/model.js';

type HeldMovement = Readonly<{ up: boolean; down: boolean; left: boolean; right: boolean; dash: boolean }>;
type HeldAttack = Readonly<{ up: boolean; down: boolean; left: boolean; right: boolean; shift: boolean }>;

export interface ArenaInputSource {
  movement(): HeldMovement;
  attack(): HeldAttack;
  reset(): void;
}

export type ArenaInputLifecycle = Readonly<{
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  documentTarget: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  onShutdown(listener: () => void): () => void;
}>;

const INPUT_STEP_MS = 1_000 / GAME.maxInputFramesPerSecond;

function resolveAttackDirection(held: HeldAttack): Vec2 | null {
  const direction = normalizeAxes(Number(held.right) - Number(held.left), Number(held.down) - Number(held.up));
  return direction.x === 0 && direction.y === 0 ? null : direction;
}

export class ArenaInput {
  private lastSampleAtMs = Number.NEGATIVE_INFINITY;
  private lastAttackFacing: Vec2 = { x: 1, y: 0 };
  private attackDirectionHeld = false;
  private heavyLatched = false;
  private previousShift = false;
  private previousDash = false;
  private suppressQuickUntilNeutral = false;
  private suppressHeldUntilRelease = false;
  private readonly removeLifecycle: Array<() => void> = [];

  constructor(private readonly source: ArenaInputSource, lifecycle?: ArenaInputLifecycle) {
    if (!lifecycle) return;
    const clear = (): void => this.clearHeld();
    const clearWhenHidden = (): void => {
      if (lifecycle.documentTarget.visibilityState === 'hidden') clear();
    };
    lifecycle.windowTarget.addEventListener('blur', clear);
    lifecycle.documentTarget.addEventListener('visibilitychange', clearWhenHidden);
    this.removeLifecycle.push(
      () => lifecycle.windowTarget.removeEventListener('blur', clear),
      () => lifecycle.documentTarget.removeEventListener('visibilitychange', clearWhenHidden),
      lifecycle.onShutdown(clear)
    );
  }

  sample(seq: number, nowMs: number): InputFrame | null {
    if (nowMs - this.lastSampleAtMs + Number.EPSILON < INPUT_STEP_MS) return null;
    this.lastSampleAtMs = nowMs;
    const movementHeld = this.source.movement();
    const attackHeld = this.source.attack();
    if (this.suppressHeldUntilRelease) {
      const stillHeld = movementHeld.up || movementHeld.down || movementHeld.left || movementHeld.right || movementHeld.dash ||
        attackHeld.up || attackHeld.down || attackHeld.left || attackHeld.right || attackHeld.shift;
      if (stillHeld) return this.idleFrame(seq);
      this.suppressHeldUntilRelease = false;
    }

    const movement = normalizeAxes(
      Number(movementHeld.right) - Number(movementHeld.left),
      Number(movementHeld.down) - Number(movementHeld.up)
    );
    const attackDirection = resolveAttackDirection(attackHeld);
    const quick = attackDirection !== null && !attackHeld.shift && !this.attackDirectionHeld && !this.suppressQuickUntilNeutral;
    if (attackHeld.shift && attackDirection !== null) this.heavyLatched = true;
    const heavy = attackHeld.shift && (this.heavyLatched || attackDirection !== null);
    const dash = movementHeld.dash && !this.previousDash;
    const aim = attackDirection ?? this.lastAttackFacing;

    if (attackDirection) this.lastAttackFacing = attackDirection;
    if (this.previousShift && !attackHeld.shift && this.heavyLatched) this.suppressQuickUntilNeutral = true;
    if (attackDirection === null) this.suppressQuickUntilNeutral = false;
    if (!attackHeld.shift) this.heavyLatched = false;
    this.attackDirectionHeld = attackDirection !== null;
    this.previousShift = attackHeld.shift;
    this.previousDash = movementHeld.dash;

    return { seq, moveX: movement.x, moveY: movement.y, aimX: aim.x, aimY: aim.y, quick, heavy, dash };
  }

  clearHeld(): void {
    this.source.reset();
    this.attackDirectionHeld = false;
    this.heavyLatched = false;
    this.previousShift = false;
    this.previousDash = false;
    this.suppressQuickUntilNeutral = false;
    this.suppressHeldUntilRelease = true;
  }

  dispose(): void {
    this.clearHeld();
    for (const remove of this.removeLifecycle.splice(0)) remove();
  }

  private idleFrame(seq: number): InputFrame {
    return { seq, moveX: 0, moveY: 0, aimX: this.lastAttackFacing.x, aimY: this.lastAttackFacing.y, quick: false, heavy: false, dash: false };
  }
}

type PhaserSceneInput = Pick<Phaser.Scene, 'input'>;

export function createPhaserInputSource(scene: PhaserSceneInput): ArenaInputSource {
  const keyboard = scene.input.keyboard;
  if (!keyboard) throw new Error('Keyboard input is required for Neon Knockout.');
  const keys = keyboard.addKeys({
    w: 'W', a: 'A', s: 'S', d: 'D',
    up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
    shift: 'SHIFT', dash: 'SPACE'
  }) as Record<string, Phaser.Input.Keyboard.Key>;
  keyboard.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'SPACE']);
  return {
    movement: () => ({
      up: Boolean(keys.w?.isDown), down: Boolean(keys.s?.isDown),
      left: Boolean(keys.a?.isDown), right: Boolean(keys.d?.isDown), dash: Boolean(keys.dash?.isDown)
    }),
    attack: () => ({
      up: Boolean(keys.up?.isDown), down: Boolean(keys.down?.isDown),
      left: Boolean(keys.left?.isDown), right: Boolean(keys.right?.isDown), shift: Boolean(keys.shift?.isDown)
    }),
    reset: () => keyboard.resetKeys()
  };
}
