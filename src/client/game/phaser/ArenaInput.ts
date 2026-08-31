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
  dispose?(): void;
  onSuspend?(listener: () => void): () => void;
}

export type ArenaInputLifecycle = Readonly<{
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  documentTarget: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  onShutdown(listener: () => void): () => void;
}>;

const INPUT_STEP_MS = 1_000 / GAME.maxInputFramesPerSecond;
const SCENE_PAUSE_EVENT = 'pause';
const SCENE_SLEEP_EVENT = 'sleep';
const CAPTURED_KEY_CODES = [87, 65, 83, 68, 38, 40, 37, 39, 16, 32];
const GAMEPLAY_CODE_TO_KEY = new Map([
  ['KeyW', 'moveUp'], ['KeyA', 'moveLeft'], ['KeyS', 'moveDown'], ['KeyD', 'moveRight'], ['Space', 'dash'],
  ['ArrowUp', 'attackUp'], ['ArrowDown', 'attackDown'], ['ArrowLeft', 'attackLeft'], ['ArrowRight', 'attackRight'],
  ['ShiftLeft', 'shift'], ['ShiftRight', 'shift']
]);
type GameplayKey = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'dash' | 'attackUp' | 'attackDown' | 'attackLeft' | 'attackRight' | 'shift';
type CaptureLease = { owners: number; addedByUs: boolean };
const captureLeases = new WeakMap<object, Map<number, CaptureLease>>();

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
  private disposed = false;
  private readonly rawHeldCodes = new Set<string>();
  private readonly blockedRawCodes = new Set<string>();
  private readonly blockedSourceKeys = new Set<GameplayKey>();
  private readonly removeLifecycle: Array<() => void> = [];

  constructor(private readonly source: ArenaInputSource, lifecycle?: ArenaInputLifecycle) {
    const clear = (): void => this.clearHeld();
    const removeSuspend = source.onSuspend?.(clear);
    if (removeSuspend) this.removeLifecycle.push(removeSuspend);
    if (!lifecycle) return;
    const keyDown = (event: Event): void => this.recordRawKeyDown((event as KeyboardEvent).code);
    const keyUp = (event: Event): void => this.recordRawKeyUp((event as KeyboardEvent).code);
    const clearWhenHidden = (): void => {
      if (lifecycle.documentTarget.visibilityState === 'hidden') clear();
    };
    lifecycle.windowTarget.addEventListener('blur', clear);
    lifecycle.windowTarget.addEventListener('keydown', keyDown);
    lifecycle.windowTarget.addEventListener('keyup', keyUp);
    lifecycle.documentTarget.addEventListener('visibilitychange', clearWhenHidden);
    this.removeLifecycle.push(
      () => lifecycle.windowTarget.removeEventListener('blur', clear),
      () => lifecycle.windowTarget.removeEventListener('keydown', keyDown),
      () => lifecycle.windowTarget.removeEventListener('keyup', keyUp),
      () => lifecycle.documentTarget.removeEventListener('visibilitychange', clearWhenHidden),
      lifecycle.onShutdown(clear)
    );
  }

  sample(seq: number, nowMs: number): InputFrame | null {
    if (nowMs - this.lastSampleAtMs + Number.EPSILON < INPUT_STEP_MS) return null;
    this.lastSampleAtMs = nowMs;
    const movementHeld = this.source.movement();
    const attackHeld = this.source.attack();
    if (this.suppressHeldUntilRelease && !this.releaseGateIsOpen(movementHeld, attackHeld)) return this.idleFrame(seq);
    this.suppressHeldUntilRelease = false;

    const movement = normalizeAxes(
      Number(movementHeld.right) - Number(movementHeld.left),
      Number(movementHeld.down) - Number(movementHeld.up)
    );
    const attackDirection = resolveAttackDirection(attackHeld);
    const physicalAttackDirectionHeld = attackHeld.up || attackHeld.down || attackHeld.left || attackHeld.right;
    const releasedHeavy = this.previousShift && !attackHeld.shift && this.heavyLatched;
    if (releasedHeavy) this.suppressQuickUntilNeutral = true;
    const quick = attackDirection !== null && !attackHeld.shift && !this.attackDirectionHeld && !this.suppressQuickUntilNeutral;
    if (attackHeld.shift && attackDirection !== null) this.heavyLatched = true;
    const heavy = attackHeld.shift && (this.heavyLatched || attackDirection !== null);
    const dash = movementHeld.dash && !this.previousDash;
    const aim = attackDirection ?? this.lastAttackFacing;

    if (attackDirection) this.lastAttackFacing = attackDirection;
    if (!physicalAttackDirectionHeld) this.suppressQuickUntilNeutral = false;
    if (!attackHeld.shift) this.heavyLatched = false;
    this.attackDirectionHeld = physicalAttackDirectionHeld;
    this.previousShift = attackHeld.shift;
    this.previousDash = movementHeld.dash;

    return { seq, moveX: movement.x, moveY: movement.y, aimX: aim.x, aimY: aim.y, quick, heavy, dash };
  }

  clearHeld(): void {
    const movementHeld = this.source.movement();
    const attackHeld = this.source.attack();
    for (const code of this.rawHeldCodes) this.blockedRawCodes.add(code);
    for (const key of heldSourceKeys(movementHeld, attackHeld)) {
      if (!hasRawHeldKey(this.rawHeldCodes, key)) this.blockedSourceKeys.add(key);
    }
    this.source.reset();
    this.attackDirectionHeld = false;
    this.heavyLatched = false;
    this.previousShift = false;
    this.previousDash = false;
    this.suppressQuickUntilNeutral = false;
    this.suppressHeldUntilRelease = this.blockedRawCodes.size > 0 || this.blockedSourceKeys.size > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHeld();
    for (const remove of this.removeLifecycle.splice(0)) remove();
    this.source.dispose?.();
  }

  private idleFrame(seq: number): InputFrame {
    return { seq, moveX: 0, moveY: 0, aimX: this.lastAttackFacing.x, aimY: this.lastAttackFacing.y, quick: false, heavy: false, dash: false };
  }

  private recordRawKeyDown(code: string): void {
    if (!GAMEPLAY_CODE_TO_KEY.has(code)) return;
    this.rawHeldCodes.add(code);
    if (this.suppressHeldUntilRelease) this.blockedRawCodes.add(code);
  }

  private recordRawKeyUp(code: string): void {
    this.rawHeldCodes.delete(code);
    this.blockedRawCodes.delete(code);
  }

  private releaseGateIsOpen(movementHeld: HeldMovement, attackHeld: HeldAttack): boolean {
    for (const key of this.blockedSourceKeys) {
      if (!isSourceKeyHeld(key, movementHeld, attackHeld)) this.blockedSourceKeys.delete(key);
    }
    return this.blockedRawCodes.size === 0 && this.blockedSourceKeys.size === 0;
  }
}

type PhaserSceneInput = Pick<Phaser.Scene, 'input' | 'events'>;

export function createPhaserInputSource(scene: PhaserSceneInput): ArenaInputSource {
  const keyboard = scene.input.keyboard;
  if (!keyboard) throw new Error('Keyboard input is required for Neon Knockout.');
  const keys = keyboard.addKeys({
    w: 'W', a: 'A', s: 'S', d: 'D',
    up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
    shift: 'SHIFT', dash: 'SPACE'
  }) as Record<string, Phaser.Input.Keyboard.Key>;
  const releaseCaptures = acquireCaptures(keyboard);
  const onSuspend = (listener: () => void): (() => void) => {
    scene.events.on(SCENE_PAUSE_EVENT, listener);
    scene.events.on(SCENE_SLEEP_EVENT, listener);
    return () => {
      scene.events.off(SCENE_PAUSE_EVENT, listener);
      scene.events.off(SCENE_SLEEP_EVENT, listener);
    };
  };
  return {
    movement: () => ({
      up: Boolean(keys.w?.isDown), down: Boolean(keys.s?.isDown),
      left: Boolean(keys.a?.isDown), right: Boolean(keys.d?.isDown), dash: Boolean(keys.dash?.isDown)
    }),
    attack: () => ({
      up: Boolean(keys.up?.isDown), down: Boolean(keys.down?.isDown),
      left: Boolean(keys.left?.isDown), right: Boolean(keys.right?.isDown), shift: Boolean(keys.shift?.isDown)
    }),
    reset: () => keyboard.resetKeys(),
    dispose: releaseCaptures,
    onSuspend
  };
}

function heldSourceKeys(movement: HeldMovement, attack: HeldAttack): GameplayKey[] {
  return [
    ...(movement.up ? ['moveUp' as const] : []), ...(movement.down ? ['moveDown' as const] : []),
    ...(movement.left ? ['moveLeft' as const] : []), ...(movement.right ? ['moveRight' as const] : []),
    ...(movement.dash ? ['dash' as const] : []), ...(attack.up ? ['attackUp' as const] : []),
    ...(attack.down ? ['attackDown' as const] : []), ...(attack.left ? ['attackLeft' as const] : []),
    ...(attack.right ? ['attackRight' as const] : []), ...(attack.shift ? ['shift' as const] : [])
  ];
}

function hasRawHeldKey(codes: ReadonlySet<string>, key: GameplayKey): boolean {
  return [...codes].some((code) => GAMEPLAY_CODE_TO_KEY.get(code) === key);
}

function isSourceKeyHeld(key: GameplayKey, movement: HeldMovement, attack: HeldAttack): boolean {
  return ({ moveUp: movement.up, moveDown: movement.down, moveLeft: movement.left, moveRight: movement.right, dash: movement.dash, attackUp: attack.up, attackDown: attack.down, attackLeft: attack.left, attackRight: attack.right, shift: attack.shift } as Record<GameplayKey, boolean>)[key];
}

function acquireCaptures(keyboard: Phaser.Input.Keyboard.KeyboardPlugin): () => void {
  const manager = keyboard.manager as object;
  const leases = captureLeases.get(manager) ?? new Map<number, CaptureLease>();
  captureLeases.set(manager, leases);
  const existing = new Set(keyboard.getCaptures());
  const toAdd: number[] = [];
  for (const code of CAPTURED_KEY_CODES) {
    const lease = leases.get(code);
    if (lease) lease.owners += 1;
    else {
      leases.set(code, { owners: 1, addedByUs: !existing.has(code) });
      if (!existing.has(code)) toAdd.push(code);
    }
  }
  if (toAdd.length > 0) keyboard.addCapture(toAdd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const toRemove: number[] = [];
    for (const code of CAPTURED_KEY_CODES) {
      const lease = leases.get(code);
      if (!lease) continue;
      lease.owners -= 1;
      if (lease.owners === 0) {
        if (lease.addedByUs) toRemove.push(code);
        leases.delete(code);
      }
    }
    if (toRemove.length > 0) keyboard.removeCapture(toRemove);
  };
}
