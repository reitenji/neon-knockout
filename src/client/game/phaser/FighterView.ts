import Phaser from 'phaser';
import { ACCENTS } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer, Vec2 } from '../../../shared/model.js';

export interface FighterView {
  readonly outer: Phaser.GameObjects.Container;
  readonly content: Phaser.GameObjects.Container;
  apply(player: MatchPlayer, position: Vec2, facing: Vec2, predictedAction: MatchAction | null): void;
  destroy(): void;
}

function silhouettePoints(player: MatchPlayer): Phaser.Types.Math.Vector2Like[] {
  if (player.chassis === 'BASTION') {
    return [{ x: -27, y: -19 }, { x: 22, y: -24 }, { x: 34, y: 0 }, { x: 22, y: 24 }, { x: -27, y: 19 }, { x: -18, y: 0 }];
  }
  if (player.chassis === 'PULSE') {
    return [{ x: 34, y: 0 }, { x: -24, y: -23 }, { x: -10, y: 0 }, { x: -24, y: 23 }];
  }
  if (player.chassis === 'WRAITH') {
    return [{ x: 30, y: 0 }, { x: 6, y: -27 }, { x: -25, y: -18 }, { x: -12, y: 0 }, { x: -25, y: 18 }, { x: 6, y: 27 }];
  }
  return [{ x: 34, y: 0 }, { x: -12, y: -18 }, { x: -28, y: 0 }, { x: -12, y: 18 }];
}

export function createFighterView(scene: Phaser.Scene, player: MatchPlayer, isLocal: boolean): FighterView {
  const outer = scene.add.container(player.position.x, player.position.y);
  const content = scene.add.container(0, 0);
  const accent = Number.parseInt(ACCENTS[player.accent].slice(1), 16);
  const shadow = scene.add.ellipse(0, 13, 70, 28, 0x000000, 0.42);
  const body = scene.add.polygon(0, 0, silhouettePoints(player), 0x101820, 1)
    .setStrokeStyle(isLocal ? 4 : 3, accent, 1);
  const core = scene.add.rectangle(2, 0, 12, 12, accent, 0.9).setRotation(Math.PI / 4);
  content.add([shadow, body, core]);
  outer.add(content);

  return {
    outer,
    content,
    apply(nextPlayer, position, facing, predictedAction) {
      outer.setPosition(position.x, position.y);
      content.setRotation(Math.atan2(facing.y, facing.x));
      content.setScale(nextPlayer.respawnRemainingMs > 0 ? 0.7 : 1);
      body.setAlpha(nextPlayer.protectionRemainingMs > 0 ? 0.65 : 1);
      core.setScale(predictedAction?.kind ? 1.25 : 1);
    },
    destroy() { outer.destroy(true); }
  };
}
