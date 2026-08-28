import { describe, expect, it, vi } from 'vitest';
import { KeyboardController, type KeyboardWindow } from './keyboard.js';

function createWindowStub(): KeyboardWindow & {
  dispatch(type: 'keydown' | 'keyup' | 'blur', event?: KeyboardEvent): void;
  listenerCount(type: 'keydown' | 'keyup' | 'blur'): number;
} {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener as EventListener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener as EventListener);
    },
    dispatch(type, event) {
      const payload = event ?? new Event(type);
      for (const listener of listeners.get(type) ?? []) listener(payload);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    }
  };
}

function createKeyboardEvent(type: 'keydown' | 'keyup', code: string, repeat = false) {
  return {
    type,
    code,
    repeat,
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent;
}

describe('KeyboardController', () => {
  it('emits one dash edge while Space remains held', () => {
    const keyboard = new KeyboardController(createWindowStub());
    keyboard.keyDown('Space');

    expect(keyboard.sample(1).dash).toBe(true);
    expect(keyboard.sample(2).dash).toBe(false);

    keyboard.keyUp('Space');
    keyboard.keyDown('Space');
    expect(keyboard.sample(3).dash).toBe(true);
  });

  it('treats WASD and arrow keys as equivalent independent bindings', () => {
    const keyboard = new KeyboardController(createWindowStub());

    keyboard.keyDown('KeyW');
    keyboard.keyDown('ArrowUp');
    keyboard.keyDown('KeyD');
    keyboard.keyUp('KeyW');

    expect(keyboard.sample(4)).toEqual({
      seq: 4,
      up: true,
      right: true,
      down: false,
      left: false,
      dash: false
    });
  });

  it('resets held keys on blur and only suppresses game-key scrolling while active', () => {
    const windowStub = createWindowStub();
    const keyboard = new KeyboardController(windowStub);
    const inactiveEvent = createKeyboardEvent('keydown', 'ArrowUp');
    windowStub.dispatch('keydown', inactiveEvent);
    expect(inactiveEvent.preventDefault).not.toHaveBeenCalled();

    keyboard.setActive(true);
    const activeEvent = createKeyboardEvent('keydown', 'ArrowDown');
    windowStub.dispatch('keydown', activeEvent);
    expect(activeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(keyboard.sample(5).down).toBe(true);

    const unrelatedEvent = createKeyboardEvent('keydown', 'KeyQ');
    windowStub.dispatch('keydown', unrelatedEvent);
    expect(unrelatedEvent.preventDefault).not.toHaveBeenCalled();

    windowStub.dispatch('blur');
    expect(keyboard.sample(6)).toEqual({
      seq: 6,
      up: false,
      down: false,
      left: false,
      right: false,
      dash: false
    });
  });

  it('does not replay movement or dash keydowns captured while inactive', () => {
    const windowStub = createWindowStub();
    const keyboard = new KeyboardController(windowStub);

    windowStub.dispatch('keydown', createKeyboardEvent('keydown', 'ArrowUp'));
    windowStub.dispatch('keydown', createKeyboardEvent('keydown', 'Space'));
    keyboard.setActive(true);

    expect(keyboard.sample(7)).toEqual({
      seq: 7,
      up: false,
      down: false,
      left: false,
      right: false,
      dash: false
    });
  });

  it('removes every listener and clears state when destroyed', () => {
    const windowStub = createWindowStub();
    const keyboard = new KeyboardController(windowStub);
    expect(windowStub.listenerCount('keydown')).toBe(1);
    expect(windowStub.listenerCount('keyup')).toBe(1);
    expect(windowStub.listenerCount('blur')).toBe(1);

    keyboard.keyDown('KeyA');
    keyboard.destroy();

    expect(windowStub.listenerCount('keydown')).toBe(0);
    expect(windowStub.listenerCount('keyup')).toBe(0);
    expect(windowStub.listenerCount('blur')).toBe(0);
    expect(keyboard.sample(7).left).toBe(false);
  });
});
