import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../../shared/model.js';
import { ArenaInput, type ArenaInputSource } from './ArenaInput.js';

function source(): ArenaInputSource & {
  held: Record<'up' | 'down' | 'left' | 'right' | 'dash', boolean>;
  pointer: { x: number; y: number; leftDown: boolean; rightDown: boolean };
} {
  const held = { up: false, down: false, left: false, right: false, dash: false };
  const pointer = { x: 0, y: 0, leftDown: false, rightDown: false };
  return {
    held, pointer,
    movement() { return { ...held }; },
    pointerState() { return { ...pointer }; },
    projectPointer(x, y) { return { x: x + 100, y: y + 50 }; },
    reset: vi.fn(() => {
      for (const key of Object.keys(held) as Array<keyof typeof held>) held[key] = false;
    })
  };
}

function eventTarget(): Pick<Window, 'addEventListener' | 'removeEventListener'> & EventTarget {
  return new EventTarget() as Pick<Window, 'addEventListener' | 'removeEventListener'> & EventTarget;
}

describe('ArenaInput', () => {
  afterEach(() => vi.restoreAllMocks());

  it('combines WASD/arrows, projects camera aim, retains near-zero facing, and maps mouse actions', () => {
    const controls = source();
    controls.held.up = true;
    controls.held.right = true;
    controls.pointer.x = 200;
    controls.pointer.y = 150;
    controls.pointer.leftDown = true;
    controls.pointer.rightDown = true;
    const input = new ArenaInput(controls);
    const first = input.sample(4, { x: 100, y: 100 }, 0)!;

    expect(first.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(first.moveY).toBeCloseTo(-Math.SQRT1_2);
    expect(first.aimX).toBeCloseTo(200 / Math.hypot(200, 100));
    expect(first.aimY).toBeCloseTo(100 / Math.hypot(200, 100));
    expect(first).toMatchObject({ seq: 4, quick: true, heavy: true, dash: false });

    controls.pointer.x = 0;
    controls.pointer.y = 50;
    const retained = input.sample(5, { x: 100, y: 100 }, 17)!;
    expect({ x: retained.aimX, y: retained.aimY }).toEqual({ x: first.aimX, y: first.aimY });
    expect(retained.quick).toBe(false);
    expect(retained.heavy).toBe(true);
  });

  it('emits no more than sixty frames per second', () => {
    const input = new ArenaInput(source());
    const position: Vec2 = { x: 0, y: 0 };
    expect(input.sample(0, position, 0)).not.toBeNull();
    expect(input.sample(1, position, 16)).toBeNull();
    expect(input.sample(1, position, 17)).not.toBeNull();
  });

  it('clears held state on blur, hidden visibility, and scene shutdown', () => {
    const controls = source();
    const windowTarget = eventTarget();
    const documentTarget = eventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'hidden' });
    const shutdownListeners = new Set<() => void>();
    const input = new ArenaInput(controls, {
      windowTarget, documentTarget,
      onShutdown(listener) { shutdownListeners.add(listener); return () => shutdownListeners.delete(listener); }
    });

    controls.held.left = true;
    windowTarget.dispatchEvent(new Event('blur'));
    expect(controls.reset).toHaveBeenCalledTimes(1);
    controls.held.up = true;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(controls.reset).toHaveBeenCalledTimes(2);
    controls.pointer.rightDown = true;
    for (const listener of shutdownListeners) listener();
    expect(controls.reset).toHaveBeenCalledTimes(3);
    expect(input.sample(0, { x: 0, y: 0 }, 0)).toMatchObject({
      moveX: 0, moveY: 0, quick: false, heavy: false, dash: false
    });

    input.dispose();
    expect(shutdownListeners).toHaveLength(0);
  });
});
