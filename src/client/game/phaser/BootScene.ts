import Phaser from 'phaser';

export const BOOT_SCENE_KEY = 'boot';
export const ARENA_SCENE_KEY = 'arena';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  create(): void {
    this.scene.start(ARENA_SCENE_KEY);
  }
}
