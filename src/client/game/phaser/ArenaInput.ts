import type Phaser from 'phaser';
import { GAME } from '../../../shared/constants.js';
import { normalizeAim, normalizeAxes } from '../../../shared/kinematics.js';
import type { InputFrame, Vec2 } from '../../../shared/model.js';

type HeldMovement = Readonly<{ up: boolean; down: boolean; left: boolean; right: boolean; dash: boolean }>;
type PointerState = Readonly<{ x: number; y: number; leftDown: boolean; rightDown: boolean }>;

export interface ArenaInputSource {
  movement(): HeldMovement;
  pointerState(): PointerState;
  projectPointer(x: number, y: number): Vec2;
  reset(): void;
}

export type ArenaInputLifecycle = Readonly<{
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  documentTarget: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  onShutdown(listener: () => void): () => void;
}>;

const INPUT_STEP_MS = 1_000 / GAME.maxInputFramesPerSecond;

export class ArenaInput {
  private lastSampleAtMs = Number.NEGATIVE_INFINITY;
  private facing: Vec2 = { x: 1, y: 0 };
  private previousLeft = false;
  private previousDash = false;
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

  sample(seq: number, playerPosition: Vec2, nowMs: number): InputFrame | null {
    if (nowMs - this.lastSampleAtMs + Number.EPSILON < INPUT_STEP_MS) return null;
    this.lastSampleAtMs = nowMs;
    const held = this.source.movement();
    const pointer = this.source.pointerState();
    if (this.suppressHeldUntilRelease) {
      const stillHeld = held.up || held.down || held.left || held.right || held.dash ||
        pointer.leftDown || pointer.rightDown;
      if (stillHeld) {
        return {
          seq, moveX: 0, moveY: 0, aimX: this.facing.x, aimY: this.facing.y,
          quick: false, heavy: false, dash: false
        };
      }
      this.suppressHeldUntilRelease = false;
    }
    const movement = normalizeAxes(Number(held.right) - Number(held.left), Number(held.down) - Number(held.up));
    const pointerWorld = this.source.projectPointer(pointer.x, pointer.y);
    this.facing = normalizeAim(pointerWorld.x - playerPosition.x, pointerWorld.y - playerPosition.y, this.facing);
    const quick = pointer.leftDown && !this.previousLeft;
    const dash = held.dash && !this.previousDash;
    this.previousLeft = pointer.leftDown;
    this.previousDash = held.dash;
    return {
      seq,
      moveX: movement.x,
      moveY: movement.y,
      aimX: this.facing.x,
      aimY: this.facing.y,
      quick,
      heavy: pointer.rightDown,
      dash
    };
  }

  clearHeld(): void {
    this.source.reset();
    this.previousLeft = false;
    this.previousDash = false;
    this.suppressHeldUntilRelease = true;
  }

  dispose(): void {
    this.clearHeld();
    for (const remove of this.removeLifecycle.splice(0)) remove();
  }
}

type PhaserSceneInput = Pick<Phaser.Scene, 'input' | 'cameras'>;

export function createPhaserInputSource(scene: PhaserSceneInput): ArenaInputSource {
  const keyboard = scene.input.keyboard;
  if (!keyboard) throw new Error('Keyboard input is required for Neon Knockout.');
  const keys = keyboard.addKeys({
    w: 'W', a: 'A', s: 'S', d: 'D',
    up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
    dash: 'SPACE'
  }) as Record<string, Phaser.Input.Keyboard.Key>;
  return {
    movement: () => ({
      up: Boolean(keys.w?.isDown || keys.up?.isDown),
      down: Boolean(keys.s?.isDown || keys.down?.isDown),
      left: Boolean(keys.a?.isDown || keys.left?.isDown),
      right: Boolean(keys.d?.isDown || keys.right?.isDown),
      dash: Boolean(keys.dash?.isDown)
    }),
    pointerState: () => {
      const pointer = scene.input.activePointer;
      return {
        x: pointer.x,
        y: pointer.y,
        leftDown: pointer.leftButtonDown(),
        rightDown: pointer.rightButtonDown()
      };
    },
    projectPointer: (x, y) => {
      const point = scene.cameras.main.getWorldPoint(x, y);
      return { x: point.x, y: point.y };
    },
    reset: () => keyboard.resetKeys()
  };
}
