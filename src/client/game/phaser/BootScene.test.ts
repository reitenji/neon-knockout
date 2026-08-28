import { describe, expect, it, vi } from 'vitest';

const svg = vi.fn();
const start = vi.fn();

vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {
      load = { svg };
      scene = { start };
    }
  }
}));

import { ARENA_SCENE_KEY, BootScene } from './BootScene.js';

describe('BootScene', () => {
  it('preloads all sixteen transparent fighter layers at authored resolution', () => {
    const scene = new BootScene();

    scene.preload();

    expect(svg).toHaveBeenCalledTimes(16);
    expect(new Set(svg.mock.calls.map(([key]) => key)).size).toBe(16);
    expect(svg).toHaveBeenCalledWith(
      'fighter-rift-body',
      '/assets/fighters/rift/body.svg',
      { width: 128, height: 128 }
    );
  });

  it('starts the arena after assets are ready', () => {
    const scene = new BootScene();

    scene.create();

    expect(start).toHaveBeenCalledWith(ARENA_SCENE_KEY);
  });
});
