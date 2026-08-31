import Phaser from 'phaser';
import { GAME } from '../../../shared/constants.js';
import type { MatchPulse } from '../../../shared/model.js';

export interface PulseView {
  apply(pulse: MatchPulse): void;
  destroy(): void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createPulseView(scene: Phaser.Scene, initialPulse: MatchPulse): PulseView {
  const outer = scene.add.container(initialPulse.position.x, initialPulse.position.y).setDepth(24);
  const energy = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
  outer.add([energy]);
  let destroyed = false;

  const apply = (pulse: MatchPulse): void => {
    if (destroyed) return;
    const radius = Math.max(1, pulse.radius);
    outer.setPosition(pulse.position.x, pulse.position.y);
    outer.setRotation(Math.atan2(pulse.velocity.y, pulse.velocity.x));
    energy.clear();
    energy.fillStyle(0x6ee7f2, 0.2);
    energy.fillRoundedRect(-radius * 3.1, -radius * 0.45, radius * 2.8, radius * 0.9, radius * 0.45);
    energy.fillStyle(0x6ee7f2, 0.3);
    energy.fillCircle(0, 0, radius * 1.45);
    energy.fillStyle(0x6ee7f2, 0.86);
    energy.fillCircle(0, 0, radius);
    energy.lineStyle(2, 0xf4f7fb, 0.94);
    energy.strokeCircle(0, 0, radius);
    energy.fillStyle(0xf4f7fb, 0.96);
    energy.fillCircle(radius * 0.16, 0, Math.max(2, radius * 0.32));
    const lifetime = clamp(pulse.remainingMs / GAME.pulseLifetimeMs, 0, 1);
    energy.setAlpha(0.55 + lifetime * 0.45);
  };

  apply(initialPulse);
  return {
    apply,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      outer.destroy(true);
    }
  };
}
