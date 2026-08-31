import { beforeEach, describe, expect, it, vi } from 'vitest';

const svg = vi.fn();
const audio = vi.fn();
const start = vi.fn();

vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {
      load = { svg, audio };
      scene = { start };
    }
  }
}));

import { ARENA_SCENE_KEY, BootScene } from './BootScene.js';

describe('BootScene', () => {
  beforeEach(() => {
    svg.mockClear();
    audio.mockClear();
    start.mockClear();
  });

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

  it('preloads every generated combat cue under its stable gameplay key', () => {
    const scene = new BootScene();

    scene.preload();

    expect(audio).toHaveBeenCalledTimes(14);
    expect(audio).toHaveBeenCalledWith('quick', '/assets/audio/quick.wav');
    expect(audio).toHaveBeenCalledWith('clash', '/assets/audio/clash.wav');
    expect(audio).toHaveBeenCalledWith('perfect-dodge', '/assets/audio/perfect-dodge.wav');
    expect(audio).toHaveBeenCalledWith('pulse-spawn', '/assets/audio/pulse-spawn.wav');
    expect(audio).toHaveBeenCalledWith('pulse-break', '/assets/audio/pulse-break.wav');
    expect(audio).toHaveBeenCalledWith('victory', '/assets/audio/victory.wav');
  });

  it('starts the arena after assets are ready', () => {
    const scene = new BootScene();

    scene.create();

    expect(start).toHaveBeenCalledWith(ARENA_SCENE_KEY);
  });
});
