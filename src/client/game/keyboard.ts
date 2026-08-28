import type { InputFrame } from '../../shared/model.js';

export type KeyboardWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const GAME_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space'
]);

function normalizeCode(code: string): string {
  if (code.length === 1) {
    const upper = code.toUpperCase();
    if (upper === 'W' || upper === 'A' || upper === 'S' || upper === 'D') return `Key${upper}`;
    if (code === ' ') return 'Space';
  }
  return code;
}

export class KeyboardController {
  private readonly pressed = new Set<string>();
  private active = false;
  private dashQueued = false;
  private destroyed = false;

  private readonly handleKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    const code = normalizeCode(keyboardEvent.code || keyboardEvent.key);
    if (!GAME_CODES.has(code)) return;
    if (!this.active) return;
    keyboardEvent.preventDefault();
    this.keyDown(code);
  };

  private readonly handleKeyUp = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    const code = normalizeCode(keyboardEvent.code || keyboardEvent.key);
    if (!GAME_CODES.has(code)) return;
    if (this.active) keyboardEvent.preventDefault();
    this.keyUp(code);
  };

  private readonly handleBlur = (): void => this.reset();

  constructor(private readonly target: KeyboardWindow) {
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    target.addEventListener('blur', this.handleBlur);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.reset();
  }

  keyDown(rawCode: string): void {
    if (this.destroyed) return;
    const code = normalizeCode(rawCode);
    if (!GAME_CODES.has(code) || this.pressed.has(code)) return;
    this.pressed.add(code);
    if (code === 'Space') this.dashQueued = true;
  }

  keyUp(rawCode: string): void {
    if (this.destroyed) return;
    this.pressed.delete(normalizeCode(rawCode));
  }

  sample(seq: number): InputFrame {
    const dash = this.dashQueued;
    this.dashQueued = false;
    return {
      seq,
      up: this.pressed.has('KeyW') || this.pressed.has('ArrowUp'),
      down: this.pressed.has('KeyS') || this.pressed.has('ArrowDown'),
      left: this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'),
      right: this.pressed.has('KeyD') || this.pressed.has('ArrowRight'),
      dash
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.target.removeEventListener('blur', this.handleBlur);
    this.reset();
  }

  private reset(): void {
    this.pressed.clear();
    this.dashQueued = false;
  }
}
