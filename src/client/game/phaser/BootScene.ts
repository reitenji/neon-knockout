import Phaser from 'phaser';
import { CHASSIS } from '../../../shared/model.js';
import {
  FIGHTER_MANIFEST,
  fighterTextureKey,
  type FighterAssetPart
} from './fighterManifest.js';
import { GAME_AUDIO_ASSETS } from './GameAudio.js';

export const BOOT_SCENE_KEY = 'boot';
export const ARENA_SCENE_KEY = 'arena';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  preload(): void {
    const parts: readonly FighterAssetPart[] = ['body', 'leftArm', 'rightArm', 'core'];
    for (const chassis of CHASSIS) {
      const assets = FIGHTER_MANIFEST[chassis];
      for (const part of parts) {
        this.load.svg(fighterTextureKey(chassis, part), assets[part], { width: 128, height: 128 });
      }
    }
    for (const [key, url] of Object.entries(GAME_AUDIO_ASSETS)) this.load.audio(key, url);
  }

  create(): void {
    this.scene.start(ARENA_SCENE_KEY);
  }
}
