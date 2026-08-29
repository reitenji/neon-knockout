import type Phaser from 'phaser';
import type { Vec2 } from '../../../shared/model.js';
import type { FighterView } from './FighterView.js';
import type { ImpactFxAdapter } from './ImpactFx.js';

export class PhaserImpactAdapter implements ImpactFxAdapter {
  private readonly objects = new Set<Phaser.GameObjects.GameObject>();
  private readonly tweens = new Set<Phaser.Tweens.Tween>();
  private readonly touchedContent = new Set<Phaser.GameObjects.Container>();
  private disposed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly viewById: (playerId: string) => FighterView | null
  ) {}

  flashTarget(playerId: string, strength: number): void {
    const content = this.content(playerId);
    if (!content) return;
    content.setAlpha(0.42 + strength * 0.18);
    this.addTween({ targets: content, alpha: 1, duration: 55 + strength * 45, ease: 'Quad.Out' });
  }

  holdHitPose(playerId: string, durationMs: number): void {
    const content = this.content(playerId);
    if (!content) return;
    content.setScale(1.12, 0.9);
    this.addTween({
      targets: content, scaleX: 1, scaleY: 1, duration: Math.max(45, durationMs), ease: 'Back.Out'
    });
  }

  emitDirectionalParticles(position: Vec2, direction: Vec2, strength: number): void {
    const baseAngle = Math.atan2(direction.y, direction.x);
    const count = 8 + Math.round(strength * 6);
    for (let index = 0; index < count; index += 1) {
      const spread = ((index / Math.max(1, count - 1)) - 0.5) * 1.35;
      const angle = baseAngle + spread;
      const distance = 42 + strength * 34 + (index % 3) * 8;
      const shard = this.track(
        this.scene.add.rectangle(position.x, position.y, 9 + strength * 7, 2 + (index % 2),
          index % 2 === 0 ? 0xf4f7fb : 0x6ee7f2, 0.95)
          .setRotation(angle)
          .setDepth(30)
      );
      this.fadeAndDestroy(shard, {
        x: position.x + Math.cos(angle) * distance,
        y: position.y + Math.sin(angle) * distance,
        alpha: 0,
        rotation: angle + (index % 2 === 0 ? 0.5 : -0.5),
        duration: 130 + index * 4,
        ease: 'Cubic.Out'
      });
    }
  }

  pulseOverload(playerId: string, overload: number, strength: number): void {
    const view = this.viewById(playerId);
    if (!view) return;
    const label = this.track(
      this.scene.add.text(view.outer.x, view.outer.y - 64, `${Math.round(overload)}%`, {
        color: '#F4F7FB', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px',
        fontStyle: '800', stroke: '#071018', strokeThickness: 5
      }).setOrigin(0.5).setDepth(34).setScale(0.82)
    );
    this.fadeAndDestroy(label, {
      y: label.y - 24 - strength * 10, alpha: 0, scaleX: 1.18, scaleY: 1.18,
      duration: 360, ease: 'Quad.Out'
    });
  }

  emitKnockbackTrail(playerId: string, direction: Vec2, strength: number): void {
    const view = this.viewById(playerId);
    if (!view) return;
    const angle = Math.atan2(direction.y, direction.x);
    const trail = this.track(
      this.scene.add.polygon(view.outer.x, view.outer.y,
        [{ x: -58, y: 0 }, { x: -14, y: -10 }, { x: 8, y: 0 }, { x: -14, y: 10 }],
        0xff8a5b, 0.3 + strength * 0.25)
        .setRotation(angle)
        .setDepth(12)
    );
    this.fadeAndDestroy(trail, {
      x: trail.x - direction.x * 30,
      y: trail.y - direction.y * 30,
      scaleX: 1.35,
      alpha: 0,
      duration: 180,
      ease: 'Quad.Out'
    });
  }

  nudgeCamera(direction: Vec2, strength: number): void {
    const camera = this.scene.cameras.main;
    this.addTween({
      targets: camera,
      scrollX: camera.scrollX + direction.x * strength * 8,
      scrollY: camera.scrollY + direction.y * strength * 8,
      duration: 42,
      yoyo: true,
      ease: 'Sine.Out'
    });
  }

  emitKnockoutBurst(position: Vec2, strength: number): void {
    for (const radius of [24, 44]) {
      const ring = this.track(
        this.scene.add.circle(position.x, position.y, radius, 0xff8a5b, radius === 24 ? 0.28 : 0.12)
          .setStrokeStyle(3, 0xf4f7fb, 0.9)
          .setDepth(31)
      );
      this.fadeAndDestroy(ring, {
        scaleX: 2.2 + strength * 0.5, scaleY: 2.2 + strength * 0.5,
        alpha: 0, duration: 360 + radius * 2, ease: 'Cubic.Out'
      });
    }
    this.emitBurstShards(position, 12, 92 + strength * 24);
    const label = this.track(
      this.scene.add.text(position.x, position.y - 28, 'RING OUT', {
        color: '#FFF0D8', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '19px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 6
      }).setOrigin(0.5).setDepth(36)
    );
    this.fadeAndDestroy(label, { y: label.y - 34, alpha: 0, scaleX: 1.18, scaleY: 1.18, duration: 520 });
  }

  emitEdgeStreak(position: Vec2, direction: Vec2): void {
    const angle = Math.atan2(direction.y, direction.x);
    const streak = this.track(
      this.scene.add.rectangle(position.x, position.y, 110, 8, 0xff8a5b, 0.72)
        .setRotation(angle)
        .setDepth(29)
    );
    this.fadeAndDestroy(streak, {
      x: position.x + direction.x * 86,
      y: position.y + direction.y * 86,
      scaleX: 1.8,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.Out'
    });
  }

  pulseScore(playerId: string, score: number): void {
    const view = this.viewById(playerId);
    const x = view?.outer.x ?? 640;
    const y = view?.outer.y ?? 360;
    const label = this.track(
      this.scene.add.text(x, y - 82, `+1  ${score}`, {
        color: '#F6D743', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '22px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 6
      }).setOrigin(0.5).setDepth(38).setScale(0.72)
    );
    this.fadeAndDestroy(label, { y: y - 118, scaleX: 1.25, scaleY: 1.25, alpha: 0, duration: 520 });
  }

  announceKnockout(attackerName: string | null, targetName: string): void {
    const message = attackerName ? `${attackerName}  >  ${targetName}` : `${targetName}  ARENA DIŞI`;
    const text = this.track(
      this.scene.add.text(640, 112, message, {
        color: '#F4F7FB', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '25px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 8
      }).setOrigin(0.5).setDepth(40).setScale(0.86)
    );
    this.fadeAndDestroy(text, { y: 96, scaleX: 1.08, scaleY: 1.08, alpha: 0, duration: 850, hold: 180 });
  }

  emitRespawn(_playerId: string, position: Vec2): void {
    const ring = this.track(
      this.scene.add.circle(position.x, position.y, 18, 0x6ee7f2, 0.12)
        .setStrokeStyle(3, 0xf4f7fb, 0.92)
        .setDepth(27)
    );
    this.fadeAndDestroy(ring, { scaleX: 3.1, scaleY: 3.1, alpha: 0, duration: 460, ease: 'Cubic.Out' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const tween of this.tweens) tween.remove();
    this.tweens.clear();
    for (const object of this.objects) object.destroy();
    this.objects.clear();
    for (const content of this.touchedContent) content.setAlpha(1).setScale(1);
    this.touchedContent.clear();
  }

  private content(playerId: string): Phaser.GameObjects.Container | null {
    const content = this.viewById(playerId)?.content ?? null;
    if (content) this.touchedContent.add(content);
    return content;
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    if (this.disposed) {
      object.destroy();
      return object;
    }
    this.objects.add(object);
    return object;
  }

  private addTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    if (this.disposed) return;
    const tween = this.scene.tweens.add(config);
    this.tweens.add(tween);
  }

  private fadeAndDestroy<T extends Phaser.GameObjects.GameObject>(
    object: T,
    properties: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>
  ): void {
    const tween = this.scene.tweens.add({
      targets: object,
      ...properties,
      onComplete: () => {
        this.tweens.delete(tween);
        if (this.objects.delete(object)) object.destroy();
      }
    });
    this.tweens.add(tween);
  }

  private emitBurstShards(position: Vec2, count: number, distance: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const shard = this.track(
        this.scene.add.rectangle(position.x, position.y, 14, 4,
          index % 2 === 0 ? 0xff8a5b : 0xf4f7fb, 0.94)
          .setRotation(angle)
          .setDepth(32)
      );
      this.fadeAndDestroy(shard, {
        x: position.x + Math.cos(angle) * distance,
        y: position.y + Math.sin(angle) * distance,
        scaleX: 0.4,
        alpha: 0,
        duration: 340 + (index % 3) * 35,
        ease: 'Cubic.Out'
      });
    }
  }
}
