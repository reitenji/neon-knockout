import Phaser from 'phaser';
import type { GamePresentationBridge, NeonGameFactory } from '../GamePresentationBridge.js';
import { ArenaScene } from './ArenaScene.js';
import { BootScene } from './BootScene.js';

const LOGICAL_WIDTH = 1_280;
const LOGICAL_HEIGHT = 720;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_MOBILE_DEVICE_PIXEL_RATIO = 1.25;

export function buildNeonGameConfig(
  parent: HTMLElement,
  bridge: GamePresentationBridge,
  options: Readonly<{ reducedMotion?: boolean; mobile?: boolean }> = {},
  devicePixelRatio = window.devicePixelRatio || 1
): Phaser.Types.Core.GameConfig {
  const mobile = options.mobile ?? (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const maximumPixelRatio = mobile ? MAX_MOBILE_DEVICE_PIXEL_RATIO : MAX_DEVICE_PIXEL_RATIO;
  return {
    type: Phaser.AUTO,
    parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    zoom: Math.max(1, Math.min(maximumPixelRatio, devicePixelRatio)),
    backgroundColor: '#02050a',
    fps: { target: 60, limit: 60, smoothStep: false },
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
