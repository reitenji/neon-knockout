import type Phaser from 'phaser';
import type { AudioPlayOptions, GameAudioAdapter, GameAudioCue } from './GameAudio.js';

type UnlockableSoundManager = Pick<Phaser.Sound.BaseSoundManager, 'locked' | 'add'> & { unlock(): void };

export class PhaserAudioAdapter implements GameAudioAdapter {
  private readonly sounds = new Set<Phaser.Sound.BaseSound>();
  private readonly gestureCleanups = new Set<() => void>();
  private destroyed = false;

  constructor(
    private readonly manager: UnlockableSoundManager,
    private readonly gestureTarget: EventTarget = window
  ) {}

  onFirstGesture(listener: () => void): () => void {
    if (this.destroyed) return () => undefined;
    let active = true;
    const remove = (): void => {
      if (!active) return;
      active = false;
      this.gestureTarget.removeEventListener('pointerdown', handleGesture);
      this.gestureTarget.removeEventListener('keydown', handleGesture);
      this.gestureCleanups.delete(remove);
    };
    const handleGesture = (): void => {
      if (!active) return;
      remove();
      listener();
    };
    this.gestureCleanups.add(remove);
    if (!this.manager.locked) queueMicrotask(handleGesture);
    else {
      this.gestureTarget.addEventListener('pointerdown', handleGesture);
      this.gestureTarget.addEventListener('keydown', handleGesture);
    }
    return remove;
  }

  unlock(): void {
    if (!this.destroyed && this.manager.locked) this.manager.unlock();
  }

  play(cue: GameAudioCue, options: AudioPlayOptions): void {
    if (this.destroyed) return;
    const sound = this.manager.add(cue);
    this.sounds.add(sound);
    sound.once('complete', () => this.release(sound));
    if (!sound.play(options)) this.release(sound);
  }

  stopAll(): void {
    for (const sound of [...this.sounds]) {
      sound.stop();
      this.release(sound);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const remove of [...this.gestureCleanups]) remove();
    this.stopAll();
  }

  private release(sound: Phaser.Sound.BaseSound): void {
    if (!this.sounds.delete(sound)) return;
    sound.destroy();
  }
}
