import type Phaser from 'phaser';
import type { Vec2 } from '../../../shared/model.js';
import type { FighterView } from './FighterView.js';
import type { ImpactFxAdapter } from './ImpactFx.js';

export class PhaserImpactAdapter implements ImpactFxAdapter {
  private static readonly KNOCKOUT_POOL_SIZE = 2;
  private static readonly KNOCKOUT_SHARD_COUNT = 12;
  private readonly objects = new Set<Phaser.GameObjects.GameObject>();
  private readonly tweens = new Set<Phaser.Tweens.Tween>();
  private readonly touchedContent = new Set<Phaser.GameObjects.Container>();
  private readonly objectTweens = new Map<object, Phaser.Tweens.Tween>();
  private readonly knockoutSlots: KnockoutSlot[] = [];
  private disposed = false;
  private nextKnockoutSlotIndex = 0;
  private activeKnockoutSlot: KnockoutSlot | null = null;
  private cameraTween: Phaser.Tweens.Tween | null = null;
  private lastCameraNudgeAtMs: number | null = null;

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
      targets: content,
      scaleX: 1,
      scaleY: 1,
      duration: Math.min(35, Math.max(12, durationMs)),
      ease: 'Quad.Out'
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

  emitClash(position: Vec2, strength: 'QUICK' | 'HEAVY'): void {
    const heavy = strength === 'HEAVY';
    const ring = this.track(
      this.scene.add.circle(position.x, position.y, heavy ? 24 : 18, 0xf6d743, heavy ? 0.3 : 0.22)
        .setStrokeStyle(heavy ? 4 : 3, 0xf4f7fb, 0.94)
        .setDepth(34)
    );
    this.fadeAndDestroy(ring, {
      scaleX: heavy ? 2.45 : 2,
      scaleY: heavy ? 2.45 : 2,
      alpha: 0,
      duration: heavy ? 280 : 210,
      ease: 'Cubic.Out'
    });
    this.emitBurstShards(position, heavy ? 10 : 6, heavy ? 92 : 68, [0xf6d743, 0xf4f7fb]);
  }

  emitPerfectDodge(position: Vec2): void {
    const ring = this.track(
      this.scene.add.circle(position.x, position.y, 26, 0x9ef25b, 0.13)
        .setStrokeStyle(3, 0x9ef25b, 0.94)
        .setDepth(33)
    );
    this.fadeAndDestroy(ring, {
      scaleX: 1.75,
      scaleY: 1.75,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.Out'
    });
    this.emitBurstShards(position, 4, 58, [0x9ef25b, 0xf4f7fb]);
  }

  emitPulseSpawn(position: Vec2): void {
    const ring = this.track(
      this.scene.add.circle(position.x, position.y, 18, 0x6ee7f2, 0.24)
        .setStrokeStyle(3, 0xf4f7fb, 0.92)
        .setDepth(32)
    );
    this.fadeAndDestroy(ring, {
      scaleX: 2.2,
      scaleY: 2.2,
      alpha: 0,
      duration: 220,
      ease: 'Cubic.Out'
    });
    this.emitBurstShards(position, 4, 52, [0x6ee7f2, 0xf4f7fb]);
  }

  emitPulseBreak(position: Vec2): void {
    const ring = this.track(
      this.scene.add.circle(position.x, position.y, 20, 0xff5fa2, 0.22)
        .setStrokeStyle(3, 0xff5fa2, 0.94)
        .setDepth(35)
    );
    this.fadeAndDestroy(ring, {
      scaleX: 2.6,
      scaleY: 2.6,
      alpha: 0,
      duration: 250,
      ease: 'Cubic.Out'
    });
    this.emitBurstShards(position, 8, 78, [0xff5fa2, 0xf6d743]);
  }

  nudgeCamera(direction: Vec2, strength: number): void {
    const nowMs = this.scene.time?.now ?? 0;
    if (this.cameraTween && this.lastCameraNudgeAtMs === nowMs) return;
    const camera = this.scene.cameras.main;
    this.lastCameraNudgeAtMs = nowMs;
    this.cameraTween = this.replaceTween(camera, {
      targets: camera,
      scrollX: camera.scrollX + direction.x * strength * 8,
      scrollY: camera.scrollY + direction.y * strength * 8,
      duration: 42,
      yoyo: true,
      ease: 'Sine.Out'
    }, () => {
      this.cameraTween = null;
    });
  }

  emitKnockoutBurst(position: Vec2, strength: number): void {
    const slot = this.beginKnockoutSlot();
    for (const [index, ring] of slot.rings.entries()) {
      ring.setPosition(position.x, position.y).setScale(1).setAlpha(index === 0 ? 0.28 : 0.12);
      this.tweenPooledObject(ring, {
        scaleX: 2.2 + strength * 0.5,
        scaleY: 2.2 + strength * 0.5,
        alpha: 0,
        duration: 360 + ring.radius * 2,
        ease: 'Cubic.Out'
      });
    }
    this.animateKnockoutShards(slot, position, 92 + strength * 24);
    slot.label.setText('RING OUT').setPosition(position.x, position.y - 28).setScale(1).setAlpha(1);
    this.tweenPooledObject(slot.label, {
      y: position.y - 62,
      alpha: 0,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 520
    });
  }

  emitEdgeStreak(position: Vec2, direction: Vec2): void {
    const slot = this.activeKnockoutSlot ?? this.beginKnockoutSlot();
    const angle = Math.atan2(direction.y, direction.x);
    slot.streak.setPosition(position.x, position.y).setRotation(angle).setScale(1).setAlpha(0.72);
    this.tweenPooledObject(slot.streak, {
      x: position.x + direction.x * 86,
      y: position.y + direction.y * 86,
      scaleX: 1.8,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.Out'
    });
  }

  pulseScore(playerId: string, score: number): void {
    const slot = this.activeKnockoutSlot ?? this.beginKnockoutSlot();
    const view = this.viewById(playerId);
    const x = view?.outer.x ?? 640;
    const y = (view?.outer.y ?? 360) - slot.index * 22;
    slot.score.setText(`+1  ${score}`).setPosition(x, y - 82).setScale(0.72).setAlpha(1);
    this.tweenPooledObject(slot.score, {
      y: y - 118,
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: 0,
      duration: 520
    });
  }

  announceKnockout(attackerName: string | null, targetName: string): void {
    const slot = this.activeKnockoutSlot ?? this.beginKnockoutSlot();
    const message = attackerName ? `${attackerName}  >  ${targetName}` : `${targetName}  ARENA DIŞI`;
    const y = 112 + slot.index * 32;
    slot.announcer.setText(message).setPosition(640, y).setScale(0.86).setAlpha(1);
    this.tweenPooledObject(slot.announcer, {
      y: y - 16,
      scaleX: 1.08,
      scaleY: 1.08,
      alpha: 0,
      duration: 850,
      hold: 180
    });
    this.activeKnockoutSlot = null;
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
    this.objectTweens.clear();
    this.cameraTween = null;
    this.activeKnockoutSlot = null;
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
    const release = () => this.tweens.delete(tween);
    tween.once('complete', release);
    tween.once('stop', release);
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

  private emitBurstShards(
    position: Vec2,
    count: number,
    distance: number,
    colors: readonly [number, number] = [0xff8a5b, 0xf4f7fb]
  ): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const shard = this.track(
        this.scene.add.rectangle(position.x, position.y, 14, 4,
          colors[index % 2]!, 0.94)
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

  private beginKnockoutSlot(): KnockoutSlot {
    const slot = this.knockoutSlots.length < PhaserImpactAdapter.KNOCKOUT_POOL_SIZE
      ? this.createKnockoutSlot(this.knockoutSlots.length)
      : this.knockoutSlots[this.nextKnockoutSlotIndex % this.knockoutSlots.length]!;
    this.nextKnockoutSlotIndex = (this.nextKnockoutSlotIndex + 1) % PhaserImpactAdapter.KNOCKOUT_POOL_SIZE;
    this.activeKnockoutSlot = slot;
    return slot;
  }

  private createKnockoutSlot(index: number): KnockoutSlot {
    const rings: [Phaser.GameObjects.Arc, Phaser.GameObjects.Arc] = [
      this.trackPooledObject(
        this.scene.add.circle(0, 0, 24, 0xff8a5b, 0).setStrokeStyle(3, 0xf4f7fb, 0.9).setDepth(31)
      ),
      this.trackPooledObject(
        this.scene.add.circle(0, 0, 44, 0xff8a5b, 0).setStrokeStyle(3, 0xf4f7fb, 0.9).setDepth(31)
      )
    ];
    const shards = Array.from({ length: PhaserImpactAdapter.KNOCKOUT_SHARD_COUNT }, (_, shardIndex) =>
      this.trackPooledObject(
        this.scene.add.rectangle(0, 0, 14, 4, shardIndex % 2 === 0 ? 0xff8a5b : 0xf4f7fb, 0)
          .setDepth(32)
      )
    );
    const label = this.trackPooledObject(
      this.scene.add.text(0, 0, '', {
        color: '#FFF0D8', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '19px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 6
      }).setOrigin(0.5).setDepth(36).setAlpha(0)
    );
    const streak = this.trackPooledObject(
      this.scene.add.rectangle(0, 0, 110, 8, 0xff8a5b, 0).setDepth(29)
    );
    const score = this.trackPooledObject(
      this.scene.add.text(0, 0, '', {
        color: '#F6D743', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '22px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 6
      }).setOrigin(0.5).setDepth(38).setScale(0.72).setAlpha(0)
    );
    const announcer = this.trackPooledObject(
      this.scene.add.text(640, 112, '', {
        color: '#F4F7FB', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '25px',
        fontStyle: '900', stroke: '#071018', strokeThickness: 8
      }).setOrigin(0.5).setDepth(40).setScale(0.86).setAlpha(0)
    );
    const slot = { index, rings, shards, label, streak, score, announcer };
    this.knockoutSlots.push(slot);
    return slot;
  }

  private animateKnockoutShards(slot: KnockoutSlot, position: Vec2, distance: number): void {
    for (const [index, shard] of slot.shards.entries()) {
      const angle = (index / slot.shards.length) * Math.PI * 2;
      shard.setPosition(position.x, position.y).setRotation(angle).setScale(1, 1).setAlpha(0.94);
      this.tweenPooledObject(shard, {
        x: position.x + Math.cos(angle) * distance,
        y: position.y + Math.sin(angle) * distance,
        scaleX: 0.4,
        alpha: 0,
        duration: 340 + (index % 3) * 35,
        ease: 'Cubic.Out'
      });
    }
  }

  private trackPooledObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    return this.track(object);
  }

  private tweenPooledObject<T extends object>(
    target: T,
    properties: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>
  ): Phaser.Tweens.Tween {
    return this.replaceTween(target, { targets: target, ...properties });
  }

  private replaceTween(
    target: object,
    config: Phaser.Types.Tweens.TweenBuilderConfig,
    onRelease?: () => void
  ): Phaser.Tweens.Tween {
    const existing = this.objectTweens.get(target);
    if (existing) {
      this.tweens.delete(existing);
      existing.remove();
      this.objectTweens.delete(target);
    }
    const tween = this.scene.tweens.add({
      ...config,
      onComplete: () => {
        this.tweens.delete(tween);
        if (this.objectTweens.get(target) === tween) this.objectTweens.delete(target);
        onRelease?.();
      },
      onStop: () => {
        this.tweens.delete(tween);
        if (this.objectTweens.get(target) === tween) this.objectTweens.delete(target);
        onRelease?.();
      }
    });
    this.tweens.add(tween);
    this.objectTweens.set(target, tween);
    return tween;
  }
}

type KnockoutSlot = Readonly<{
  index: number;
  rings: readonly [Phaser.GameObjects.Arc, Phaser.GameObjects.Arc];
  shards: readonly Phaser.GameObjects.Rectangle[];
  label: Phaser.GameObjects.Text;
  streak: Phaser.GameObjects.Rectangle;
  score: Phaser.GameObjects.Text;
  announcer: Phaser.GameObjects.Text;
}>;
