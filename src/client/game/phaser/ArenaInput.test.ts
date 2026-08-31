import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaInput, createPhaserInputSource, type ArenaInputSource } from './ArenaInput.js';

type Directions = 'up' | 'down' | 'left' | 'right';

function source(): ArenaInputSource & {
  movementHeld: Record<Directions | 'dash', boolean>;
  attackHeld: Record<Directions | 'shift', boolean>;
} {
  const movementHeld = { up: false, down: false, left: false, right: false, dash: false };
  const attackHeld = { up: false, down: false, left: false, right: false, shift: false };
  return {
    movementHeld, attackHeld,
    movement: () => ({ ...movementHeld }),
    attack: () => ({ ...attackHeld }),
    dispose: vi.fn()
  };
}

function eventTarget(): Pick<Window, 'addEventListener' | 'removeEventListener'> & EventTarget {
  return new EventTarget() as Pick<Window, 'addEventListener' | 'removeEventListener'> & EventTarget;
}

describe('ArenaInput', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits a cardinal quick from an arrow and leaves WASD movement separate', () => {
    const controls = source();
    controls.movementHeld.right = true;
    controls.attackHeld.up = true;
    const frame = new ArenaInput(controls).sample(4, 0)!;
    expect(frame).toMatchObject({ seq: 4, moveX: 1, moveY: 0, aimX: 0, aimY: -1, quick: true, heavy: false, dash: false });
  });

  it('normalizes diagonal quick aim and cancels opposing attack keys', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.up = true;
    controls.attackHeld.right = true;
    const diagonal = input.sample(0, 0)!;
    expect(diagonal.aimX).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal.aimY).toBeCloseTo(-Math.SQRT1_2);
    expect(diagonal.quick).toBe(true);
    controls.attackHeld.up = false;
    controls.attackHeld.right = false;
    input.sample(1, 17);
    controls.attackHeld.left = true;
    controls.attackHeld.right = true;
    expect(input.sample(2, 34)).toMatchObject({ aimX: diagonal.aimX, aimY: diagonal.aimY, quick: false, heavy: false });
  });

  it('does not repeat quick while an attack direction remains held', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.left = true;
    expect(input.sample(0, 0)?.quick).toBe(true);
    expect(input.sample(1, 17)?.quick).toBe(false);
  });

  it('latches heavy with Shift, supports steering, and retains the last attack direction', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.shift = true;
    controls.attackHeld.up = true;
    expect(input.sample(0, 0)).toMatchObject({ aimX: 0, aimY: -1, quick: false, heavy: true });
    controls.attackHeld.up = false;
    controls.attackHeld.right = true;
    expect(input.sample(1, 17)).toMatchObject({ aimX: 1, aimY: 0, quick: false, heavy: true });
    controls.attackHeld.right = false;
    expect(input.sample(2, 34)).toMatchObject({ aimX: 1, aimY: 0, quick: false, heavy: true });
  });

  it('locks attack direction when Shift releases and does not emit an accidental quick until neutral', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.shift = true;
    controls.attackHeld.left = true;
    input.sample(0, 0);
    controls.attackHeld.shift = false;
    expect(input.sample(1, 17)).toMatchObject({ aimX: -1, aimY: 0, quick: false, heavy: false });
    controls.attackHeld.left = false;
    expect(input.sample(2, 34)?.quick).toBe(false);
    controls.attackHeld.down = true;
    expect(input.sample(3, 51)).toMatchObject({ aimX: 0, aimY: 1, quick: true, heavy: false });
  });

  it('suppresses quick when a latched heavy falls while a new arrow is pressed', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.shift = true;
    controls.attackHeld.left = true;
    expect(input.sample(0, 0)).toMatchObject({ heavy: true, quick: false, aimX: -1 });
    controls.attackHeld.left = false;
    expect(input.sample(1, 17)).toMatchObject({ heavy: true, quick: false });
    controls.attackHeld.shift = false;
    controls.attackHeld.right = true;
    expect(input.sample(2, 34)).toMatchObject({ heavy: false, quick: false, aimX: 1 });
    controls.attackHeld.right = false;
    input.sample(3, 51);
    controls.attackHeld.right = true;
    expect(input.sample(4, 68)).toMatchObject({ quick: true, heavy: false, aimX: 1 });
  });

  it('does not repeat quick when an opposite arrow temporarily cancels a still-held direction', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.attackHeld.left = true;
    expect(input.sample(0, 0)?.quick).toBe(true);
    controls.attackHeld.right = true;
    expect(input.sample(1, 17)?.quick).toBe(false);
    controls.attackHeld.right = false;
    expect(input.sample(2, 34)).toMatchObject({ quick: false, aimX: -1 });
  });

  it('emits dash only on its rising edge and caps samples at sixty hertz', () => {
    const controls = source();
    const input = new ArenaInput(controls);
    controls.movementHeld.dash = true;
    expect(input.sample(0, 0)?.dash).toBe(true);
    expect(input.sample(1, 16)).toBeNull();
    expect(input.sample(1, 17)?.dash).toBe(false);
    controls.movementHeld.dash = false;
    input.sample(2, 34);
    controls.movementHeld.dash = true;
    expect(input.sample(3, 51)?.dash).toBe(true);
  });

  it('suppresses gameplay after blur, hidden visibility, and shutdown until every physical key releases', () => {
    const controls = source();
    const windowTarget = eventTarget();
    const documentTarget = eventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'hidden' });
    const shutdownListeners = new Set<() => void>();
    const input = new ArenaInput(controls, {
      windowTarget, documentTarget,
      onShutdown(listener) { shutdownListeners.add(listener); return () => shutdownListeners.delete(listener); }
    });
    controls.movementHeld.right = true;
    controls.attackHeld.up = true;
    windowTarget.dispatchEvent(new Event('blur'));
    expect(input.sample(0, 0)).toMatchObject({ moveX: 0, moveY: 0, quick: false, heavy: false, dash: false });
    controls.attackHeld.right = true;
    expect(input.sample(1, 17)).toMatchObject({ moveX: 0, moveY: 0, quick: false, heavy: false, dash: false });
    controls.attackHeld.up = false;
    expect(input.sample(2, 34)).toMatchObject({ moveX: 0, moveY: 0, quick: false, heavy: false, dash: false });
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    for (const listener of shutdownListeners) listener();
    controls.movementHeld.right = false;
    controls.attackHeld.right = false;
    input.sample(3, 51);
    controls.attackHeld.up = true;
    expect(input.sample(4, 68)).toMatchObject({ moveX: 0, moveY: 0, aimX: 0, aimY: -1, quick: true, heavy: false });
    input.dispose();
    expect(controls.dispose).toHaveBeenCalledOnce();
    expect(shutdownListeners).toHaveLength(0);
  });

  it('captures gameplay keys, samples WASD separately from arrow attacks, and releases only its captures', () => {
    const keys = Object.fromEntries(['w', 'a', 's', 'd', 'up', 'down', 'left', 'right', 'shift', 'dash'].map((key) => [key, { isDown: false }]));
    const keyboard = { addKeys: vi.fn(() => keys), addCapture: vi.fn(), removeCapture: vi.fn() };
    const controls = createPhaserInputSource({ input: { keyboard } } as never);
    keys.w.isDown = true;
    keys.right.isDown = true;
    expect(controls.movement()).toMatchObject({ up: true, right: false });
    expect(controls.attack()).toMatchObject({ right: true, up: false });
    expect(keyboard.addCapture).toHaveBeenCalledWith(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'SPACE']);
    controls.dispose();
    expect(keyboard.removeCapture).toHaveBeenCalledWith(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'SPACE']);
  });
});
