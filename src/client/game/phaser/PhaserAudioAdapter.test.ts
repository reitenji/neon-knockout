import { describe, expect, it, vi } from 'vitest';
import { PhaserAudioAdapter } from './PhaserAudioAdapter.js';

class FakeSound {
  readonly plays: unknown[] = [];
  stops = 0;
  destroys = 0;
  private complete: (() => void) | null = null;

  play(config: unknown): boolean { this.plays.push(config); return true; }
  stop(): boolean { this.stops += 1; return true; }
  destroy(): void { this.destroys += 1; }
  once(_event: string, listener: () => void): this { this.complete = listener; return this; }
  finish(): void { this.complete?.(); }
}

class FakeSoundManager {
  readonly sounds: FakeSound[] = [];
  readonly keys: string[] = [];
  unlocks = 0;

  constructor(public locked: boolean) {}
  add(key: string): FakeSound {
    const sound = new FakeSound();
    this.keys.push(key);
    this.sounds.push(sound);
    return sound;
  }
  unlock(): void { this.unlocks += 1; this.locked = false; }
}

describe('PhaserAudioAdapter', () => {
  it('accepts either pointer or keyboard as the one unlock gesture and removes both listeners', () => {
    const manager = new FakeSoundManager(true);
    const target = new EventTarget();
    const adapter = new PhaserAudioAdapter(manager as never, target);
    const unlocked = vi.fn();

    const remove = adapter.onFirstGesture(unlocked);
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    remove();
    adapter.unlock();

    expect(unlocked).toHaveBeenCalledTimes(1);
    expect(manager.unlocks).toBe(1);
  });

  it('delivers an already-unlocked manager asynchronously so the owner can retain cleanup', async () => {
    const manager = new FakeSoundManager(false);
    const target = new EventTarget();
    const adapter = new PhaserAudioAdapter(manager as never, target);
    const unlocked = vi.fn();

    adapter.onFirstGesture(unlocked);
    expect(unlocked).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(unlocked).toHaveBeenCalledTimes(1);
  });

  it('plays owned cue instances with volume/detune and tears them down without destroying the manager', () => {
    const manager = new FakeSoundManager(false);
    const adapter = new PhaserAudioAdapter(manager as never, new EventTarget());

    adapter.play('hit', { volume: 0.72, detune: -20 });
    adapter.play('dash', { volume: 0.64, detune: 12 });
    adapter.stopAll();
    adapter.destroy();
    adapter.destroy();

    expect(manager.keys).toEqual(['hit', 'dash']);
    expect(manager.sounds[0]?.plays).toEqual([{ volume: 0.72, detune: -20 }]);
    expect(manager.sounds.map((sound) => sound.stops)).toEqual([1, 1]);
    expect(manager.sounds.map((sound) => sound.destroys)).toEqual([1, 1]);
  });

  it('releases a completed one-shot immediately', () => {
    const manager = new FakeSoundManager(false);
    const adapter = new PhaserAudioAdapter(manager as never, new EventTarget());

    adapter.play('quick', { volume: 0.5, detune: 0 });
    manager.sounds[0]?.finish();
    adapter.stopAll();

    expect(manager.sounds[0]?.destroys).toBe(1);
    expect(manager.sounds[0]?.stops).toBe(0);
  });

  it('plays each counterplay cue through the same owned one-shot lifecycle', () => {
    const manager = new FakeSoundManager(false);
    const adapter = new PhaserAudioAdapter(manager as never, new EventTarget());

    for (const cue of ['clash', 'perfect-dodge', 'pulse-spawn', 'pulse-break'] as const) {
      adapter.play(cue, { volume: 0.7, detune: 8 });
    }
    adapter.stopAll();

    expect(manager.keys).toEqual(['clash', 'perfect-dodge', 'pulse-spawn', 'pulse-break']);
    expect(manager.sounds.every((sound) => sound.destroys === 1)).toBe(true);
  });
});
