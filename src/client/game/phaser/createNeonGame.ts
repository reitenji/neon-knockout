import Phaser from 'phaser';
import type { GamePresentationBridge, NeonGameFactory } from '../GamePresentationBridge.js';
import { ArenaScene } from './ArenaScene.js';
import { BootScene } from './BootScene.js';

const LOGICAL_WIDTH = 1_280;
const LOGICAL_HEIGHT = 720;
const MAX_DEVICE_PIXEL_RATIO = 2;

export function buildNeonGameConfig(
  parent: HTMLElement,
  bridge: GamePresentationBridge,
  options: Readonly<{ reducedMotion?: boolean }> = {},
  devicePixelRatio = window.devicePixelRatio || 1
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    zoom: Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, devicePixelRatio)),
    backgroundColor: '#02050a',
    render: { antialias: true, roundPixels: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: LOGICAL_WIDTH,
      height: LOGICAL_HEIGHT
    },
    scene: [new BootScene(), new ArenaScene(bridge, options.reducedMotion ?? false)]
  };
}

export const createNeonGame: NeonGameFactory = (parent, bridge, options) => {
  const game = new Phaser.Game(buildNeonGameConfig(parent, bridge, options));
  game.canvas?.style.setProperty('max-width', '100%');
  game.canvas?.style.setProperty('max-height', '100%');
  game.canvas?.style.setProperty('display', 'block');
  return game;
};
