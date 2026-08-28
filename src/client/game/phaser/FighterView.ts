import Phaser from 'phaser';
import { ACCENTS } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer, Vec2 } from '../../../shared/model.js';
import { AnimationDirector, type FighterAnimationTarget } from './AnimationDirector.js';
import type { FighterPose } from './animationPlan.js';
import { FIGHTER_MANIFEST, fighterTextureKey } from './fighterManifest.js';

export interface FighterView extends FighterAnimationTarget {
  readonly outer: Phaser.GameObjects.Container;
  readonly content: Phaser.GameObjects.Container;
  apply(player: MatchPlayer, position: Vec2, facing: Vec2, predictedAction: MatchAction | null): void;
  destroy(): void;
}

function colorNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function vectorPoints(points: readonly Vec2[]): Phaser.Math.Vector2[] {
  return points.map((point) => new Phaser.Math.Vector2(point.x, point.y));
}

function createGroundShadow(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const shadow = scene.add.container(-5, 11);
  const layers = [
    { width: 82, height: 28, y: 3, color: 0x06101b, alpha: 0.09 },
    { width: 69, height: 23, y: 1, color: 0x081522, alpha: 0.14 },
    { width: 56, height: 18, y: 0, color: 0x0c1a29, alpha: 0.2 }
  ] as const;

  for (const layer of layers) {
    const halfWidth = layer.width / 2;
    const halfHeight = layer.height / 2;
    const graphics = scene.add.graphics();
    graphics.fillStyle(layer.color, layer.alpha);
    graphics.fillPoints(vectorPoints([
      { x: -halfWidth, y: layer.y },
      { x: -halfWidth * 0.72, y: layer.y - halfHeight * 0.72 },
      { x: -halfWidth * 0.08, y: layer.y - halfHeight },
      { x: halfWidth * 0.66, y: layer.y - halfHeight * 0.62 },
      { x: halfWidth, y: layer.y },
      { x: halfWidth * 0.58, y: layer.y + halfHeight * 0.7 },
      { x: -halfWidth * 0.12, y: layer.y + halfHeight },
      { x: -halfWidth * 0.76, y: layer.y + halfHeight * 0.58 }
    ]), true);
    shadow.add(graphics);
  }
  return shadow;
}

function createTrail(scene: Phaser.Scene, accent: number): Phaser.GameObjects.Graphics {
  const trail = scene.add.graphics();
  trail.fillStyle(accent, 0.72);
  trail.fillPoints(vectorPoints([
    { x: -62, y: 0 }, { x: -25, y: -11 }, { x: -13, y: -5 },
    { x: -22, y: 0 }, { x: -13, y: 5 }, { x: -25, y: 11 }
  ]), true);
  trail.setBlendMode(Phaser.BlendModes.ADD);
  trail.setAlpha(0);
  return trail;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function createFighterView(
  scene: Phaser.Scene,
  player: MatchPlayer,
  isLocal: boolean,
  options: Readonly<{ reducedMotion?: boolean }> = {}
): FighterView {
  const outer = scene.add.container(player.position.x, player.position.y);
  const shadow = createGroundShadow(scene);
  const localRing = scene.add.circle(0, 2, 43, 0xffffff, 0)
    .setStrokeStyle(2.25, 0xffffff, isLocal ? 0.92 : 0);
  const content = scene.add.container(0, 0);
  const poseRoot = scene.add.container(0, 0);
  const artRoot = scene.add.container(0, 0);
  const accent = colorNumber(ACCENTS[player.accent]);
  const manifest = FIGHTER_MANIFEST[player.chassis];
  const trail = createTrail(scene, accent);
  const leftArm = scene.add.image(0, -16, fighterTextureKey(player.chassis, 'leftArm'))
    .setOrigin(0.5, 0.375)
    .setTint(accent);
  const rightArm = scene.add.image(0, 16, fighterTextureKey(player.chassis, 'rightArm'))
    .setOrigin(0.5, 0.625)
    .setTint(accent);
  const body = scene.add.image(0, 0, fighterTextureKey(player.chassis, 'body')).setTint(accent);
  const core = scene.add.image(0, 0, fighterTextureKey(player.chassis, 'core')).setTint(accent);
  const nameLabel = scene.add.text(0, -54, player.name, {
    color: '#F4F7FB',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '12px',
    fontStyle: '600',
    stroke: '#02050A',
    strokeThickness: 4
  }).setOrigin(0.5);
  const overloadLabel = scene.add.text(0, 51, '0%', {
    color: ACCENTS[player.accent],
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '11px',
    fontStyle: '700',
    stroke: '#02050A',
    strokeThickness: 3
  }).setOrigin(0.5);

  artRoot.setScale(manifest.scale);
  artRoot.add([leftArm, rightArm, body, core]);
  poseRoot.add(artRoot);
  content.add([trail, poseRoot]);
  outer.add([shadow, localRing, content, nameLabel, overloadLabel]);

  const animationDirector = new AnimationDirector(options.reducedMotion ?? prefersReducedMotion());
  let lastPosition: Vec2 | null = null;
  let lastRenderAtMs: number | null = null;
  let destroyed = false;

  const view: FighterView = {
    outer,
    content,
    applyAnimationPose(pose: FighterPose): void {
      poseRoot.setPosition(pose.bodyX, pose.bodyY);
      poseRoot.setRotation(pose.bodyRotation);
      poseRoot.setScale(pose.bodyScale);
      leftArm.setRotation(pose.leftArmAngle);
      rightArm.setRotation(pose.rightArmAngle);
      core.setScale(pose.coreScale);
      core.setAlpha(pose.coreAlpha);
      artRoot.setAlpha(pose.artAlpha);
      trail.setAlpha(pose.trailIntensity * 0.62);
      trail.setScale(0.82 + pose.trailIntensity * 0.42, 0.72 + pose.trailIntensity * 0.18);
      shadow.setAlpha(0.18 + pose.artAlpha * 0.82);
      localRing.setScale(0.98 + pose.coreScale * 0.025);
    },
    apply(nextPlayer, position, facing, predictedAction): void {
      if (destroyed) return;
      const nowMs = scene.time.now;
      outer.setPosition(position.x, position.y);
      content.setRotation(Math.atan2(facing.y, facing.x));
      nameLabel.setText(nextPlayer.name);
      overloadLabel.setText(`${Math.round(nextPlayer.overload)}%`);

      const elapsedMs = lastRenderAtMs === null ? 0 : Math.max(1, nowMs - lastRenderAtMs);
      const measuredVelocity = isLocal && lastPosition && elapsedMs > 0
        ? {
            x: ((position.x - lastPosition.x) * 1_000) / elapsedMs,
            y: ((position.y - lastPosition.y) * 1_000) / elapsedMs
          }
        : nextPlayer.velocity;
      const presentationPlayer: MatchPlayer = {
        ...nextPlayer,
        position,
        facing,
        velocity: measuredVelocity
      };
      animationDirector.apply(presentationPlayer, view, nowMs, predictedAction);
      lastPosition = position;
      lastRenderAtMs = nowMs;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      animationDirector.forget(view);
      outer.destroy(true);
    }
  };

  return view;
}
