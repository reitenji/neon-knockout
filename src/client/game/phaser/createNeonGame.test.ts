import { describe, expect, it, vi } from 'vitest';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';

vi.mock('phaser', () => {
  class Scene {
    scene = { start() {} };
    constructor() {}
  }
  return {
    default: {
      AUTO: 'AUTO',
      Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
      Scene,
      Scenes: { Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
      Game: class Game {}
    }
  };
});

import Phaser from 'phaser';
import { buildNeonGameConfig } from './createNeonGame.js';

const bridge: GamePresentationBridge = {
  getSnapshot: () => null,
  isConnected: () => true,
  subscribeSnapshot: () => () => undefined,
  subscribeConnected: () => () => undefined,
  subscribeEvent: () => () => undefined,
  subscribeMuted: () => () => undefined,
  sendInput: () => undefined
};

describe('buildNeonGameConfig', () => {
  it('uses one 1280x720 AUTO game with FIT and CENTER_BOTH scaling and capped DPR', () => {
    const parent = document.createElement('div');
    const config = buildNeonGameConfig(parent, bridge, { reducedMotion: true }, 4);

    expect(config).toMatchObject({
      type: Phaser.AUTO,
      width: 1280,
      height: 720,
      parent,
      zoom: 2,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 1280,
        height: 720
      }
    });
    expect(config.scene).toHaveLength(2);
  });
});
