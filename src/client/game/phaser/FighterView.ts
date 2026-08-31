import Phaser from 'phaser';
import { ACCENTS } from '../../../shared/constants.js';
import { buildAttackCapsule, type SweptCapsule } from '../../../shared/combat/geometry.js';
import { profileForAttack, type AttackProfile, type AttackProfileId } from '../../../shared/combat/profiles.js';
import type { MatchAction, MatchPlayer, Vec2 } from '../../../shared/model.js';
import { AnimationDirector, type FighterAnimationTarget } from './AnimationDirector.js';
import type { FighterPose } from './animationPlan.js';
import { FIGHTER_MANIFEST, fighterTextureKey } from './fighterManifest.js';

export interface FighterView extends FighterAnimationTarget {
  readonly outer: Phaser.GameObjects.Container;
  readonly content: Phaser.GameObjects.Container;
  apply(
    player: MatchPlayer,
    position: Vec2,
    facing: Vec2,
    predictedAction: MatchAction | null,
    attackTelegraph?: AttackTelegraph | null,
    chargeIndicator?: ChargeIndicatorState | null
  ): void;
  destroy(): void;
}

export type AttackTelegraph = Readonly<{
  profileId: AttackProfileId;
  facing: Vec2;
  previousProgress: number;
  currentProgress: number;
  active: boolean;
}>;

export type ChargeIndicatorState = Readonly<{
  facing: Vec2;
  progress: number;
  pulseReady: boolean;
}>;

function colorNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function vectorPoints(points: readonly Vec2[]): Phaser.Math.Vector2[] {
  return points.map((point) => new Phaser.Math.Vector2(point.x, point.y));
}

function createContactFootprint(scene: Phaser.Scene, accent: number): Phaser.GameObjects.Container {
  const footprint = scene.add.container(-4, 15);
  const underglow = scene.add.graphics();
  underglow.fillStyle(accent, 0.14);
  underglow.fillPoints(vectorPoints([
    { x: -46, y: 0 },
    { x: -31, y: -12 },
    { x: 3, y: -15 },
    { x: 44, y: -7 },
    { x: 49, y: 2 },
    { x: 31, y: 12 },
    { x: -6, y: 15 },
    { x: -42, y: 8 }
  ]), true);
  underglow.setBlendMode(Phaser.BlendModes.ADD);

  const trace = scene.add.graphics();
  trace.lineStyle(2, accent, 0.72);
  trace.strokePoints(vectorPoints([
    { x: -43, y: 1 }, { x: -30, y: -9 }, { x: -12, y: -12 }
  ]), false);
  trace.strokePoints(vectorPoints([
    { x: 13, y: -11 }, { x: 37, y: -6 }, { x: 45, y: 1 }
  ]), false);
  trace.strokePoints(vectorPoints([
    { x: 40, y: 5 }, { x: 27, y: 10 }, { x: 9, y: 12 }
  ]), false);
  trace.strokePoints(vectorPoints([
    { x: -12, y: 12 }, { x: -33, y: 8 }, { x: -40, y: 4 }
  ]), false);
  trace.lineStyle(1.25, 0xffffff, 0.44);
  trace.strokePoints(vectorPoints([
    { x: -7, y: -13 }, { x: 4, y: -14 }, { x: 11, y: -12 }
  ]), false);
  trace.setBlendMode(Phaser.BlendModes.ADD);

  const contacts = scene.add.graphics();
  contacts.fillStyle(accent, 0.74);
  contacts.fillPoints(vectorPoints([
    { x: -31, y: 5 }, { x: -18, y: 2 }, { x: -12, y: 6 }, { x: -24, y: 10 }
  ]), true);
  contacts.fillPoints(vectorPoints([
    { x: 15, y: 3 }, { x: 29, y: 5 }, { x: 24, y: 9 }, { x: 11, y: 7 }
  ]), true);
  contacts.setBlendMode(Phaser.BlendModes.ADD);

  footprint.add([underglow, trace, contacts]);
  return footprint;
}

function createLocalMarker(scene: Phaser.Scene, accent: number, visible: boolean): Phaser.GameObjects.Graphics {
  const marker = scene.add.graphics();
  marker.lineStyle(2.25, accent, visible ? 0.9 : 0);
  const corners = [
    [{ x: -18, y: -49 }, { x: 0, y: -54 }, { x: 18, y: -49 }],
    [{ x: 49, y: -18 }, { x: 54, y: 0 }, { x: 49, y: 18 }],
    [{ x: 18, y: 49 }, { x: 0, y: 54 }, { x: -18, y: 49 }],
    [{ x: -49, y: 18 }, { x: -54, y: 0 }, { x: -49, y: -18 }]
  ] as const;
  for (const corner of corners) {
    marker.strokePoints(vectorPoints(corner), false);
  }
  marker.setBlendMode(Phaser.BlendModes.ADD);
  return marker;
}

function createTrail(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const trail = scene.add.graphics();
  trail.setBlendMode(Phaser.BlendModes.ADD);
  trail.setAlpha(0);
  return trail;
}

function profileForId(profileId: AttackProfileId): AttackProfile {
  switch (profileId) {
    case 'quick-1': return profileForAttack('QUICK_1');
    case 'quick-2': return profileForAttack('QUICK_2');
    case 'quick-3': return profileForAttack('QUICK_3');
    case 'heavy-melee': return profileForAttack('HEAVY');
  }
}

export function capsuleForAttackTelegraph(origin: Vec2, telegraph: AttackTelegraph): SweptCapsule | null {
  if (!telegraph.active) return null;
  return buildAttackCapsule(
    origin,
    telegraph.facing,
    profileForId(telegraph.profileId),
    telegraph.previousProgress,
    telegraph.currentProgress
  );
}

function drawAttackTrail(
  trail: Phaser.GameObjects.Graphics,
  accent: number,
  telegraph: AttackTelegraph | null
): boolean {
  trail.clear();
  if (!telegraph) return false;
  const capsule = capsuleForAttackTelegraph({ x: 0, y: 0 }, telegraph);
  if (!capsule) return false;
  const diameter = capsule.radius * 2;
  trail.lineStyle(diameter, accent, 0.68);
  trail.lineBetween(capsule.from.x, capsule.from.y, capsule.to.x, capsule.to.y);
  trail.fillStyle(accent, 0.68);
  trail.fillCircle(capsule.from.x, capsule.from.y, capsule.radius);
  trail.fillCircle(capsule.to.x, capsule.to.y, capsule.radius);
  return true;
}

function createChargeIndicator(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(18);
}

function drawChargeIndicator(
  indicator: Phaser.GameObjects.Graphics,
  state: ChargeIndicatorState | null,
  accent: number,
  isLocal: boolean
): void {
  indicator.clear();
  indicator.setVisible(Boolean(state));
  if (!state) return;
  const angle = Math.atan2(state.facing.y, state.facing.x);
  const activeDirection = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const innerRadius = isLocal ? 42 : 40;
  const outerRadius = isLocal ? 52 : 49;
  for (let index = 0; index < 8; index += 1) {
    const direction = index * Math.PI / 4;
    const selected = index === activeDirection;
    indicator.lineStyle(
      selected ? (isLocal ? 3.4 : 2.6) : 1.15,
      selected ? 0xf4f7fb : accent,
      selected ? (isLocal ? 1 : 0.86) : (isLocal ? 0.5 : 0.32)
    );
    indicator.lineBetween(
      Math.cos(direction) * innerRadius,
      Math.sin(direction) * innerRadius,
      Math.cos(direction) * (selected ? outerRadius + 4 : outerRadius),
      Math.sin(direction) * (selected ? outerRadius + 4 : outerRadius)
    );
  }
  const progress = Math.max(0, Math.min(1, state.progress));
  indicator.lineStyle(isLocal ? 2.4 : 1.7, state.pulseReady ? 0xf6d743 : accent, isLocal ? 0.92 : 0.72);
  indicator.beginPath();
  indicator.arc(0, 0, outerRadius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  indicator.strokePath();
  if (state.pulseReady) {
    indicator.fillStyle(0xf6d743, isLocal ? 0.98 : 0.8);
    indicator.fillCircle(
      Math.cos(angle) * (outerRadius + 7),
      Math.sin(angle) * (outerRadius + 7),
      isLocal ? 4 : 3
    );
  }
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
  const accent = colorNumber(ACCENTS[player.accent]);
  const footprint = createContactFootprint(scene, accent);
  const localMarker = createLocalMarker(scene, accent, isLocal);
  const content = scene.add.container(0, 0);
  const poseRoot = scene.add.container(0, 0);
  const artRoot = scene.add.container(0, 0);
  const manifest = FIGHTER_MANIFEST[player.chassis];
  const trail = createTrail(scene);
  const chargeIndicator = createChargeIndicator(scene);
  const leftArm = scene.add.image(0, -16, fighterTextureKey(player.chassis, 'leftArm'))
    .setOrigin(0.5, 0.375)
    .setTint(accent);
  const rightArm = scene.add.image(0, 16, fighterTextureKey(player.chassis, 'rightArm'))
    .setOrigin(0.5, 0.625)
    .setTint(accent);
  const body = scene.add.image(0, 0, fighterTextureKey(player.chassis, 'body')).setTint(accent);
  const core = scene.add.image(0, 0, fighterTextureKey(player.chassis, 'core')).setTint(accent);
  const nameLabel = scene.add.text(0, -67, player.name, {
    color: '#F4F7FB',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    fontStyle: '600',
    stroke: '#02050A',
    strokeThickness: 4
  }).setOrigin(0.5);
  const overloadLabel = scene.add.text(0, 65, '0%', {
    color: ACCENTS[player.accent],
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '12px',
    fontStyle: '700',
    stroke: '#02050A',
    strokeThickness: 3
  }).setOrigin(0.5);

  artRoot.setScale(manifest.scale);
  artRoot.add([leftArm, rightArm, body, core]);
  poseRoot.add(artRoot);
  content.add(poseRoot);
  outer.add([footprint, trail, localMarker, content, chargeIndicator, nameLabel, overloadLabel]);

  const animationDirector = new AnimationDirector(options.reducedMotion ?? prefersReducedMotion());
  let lastPosition: Vec2 | null = null;
  let lastRenderAtMs: number | null = null;
  let trailVisible = false;
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
      trail.setAlpha(trailVisible ? 0.34 + pose.trailIntensity * 0.5 : 0);
      footprint.setAlpha(0.15 + pose.artAlpha * 0.85);
      footprint.setScale(0.96 + pose.coreScale * 0.035, 0.94 + pose.coreScale * 0.025);
      localMarker.setScale(0.98 + pose.coreScale * 0.025);
    },
    apply(nextPlayer, position, facing, predictedAction, attackTelegraph = null, chargeState = null): void {
      if (destroyed) return;
      const nowMs = scene.time.now;
      outer.setPosition(position.x, position.y);
      content.setRotation(Math.atan2(facing.y, facing.x));
      nameLabel.setText(nextPlayer.name);
      overloadLabel.setText(`${Math.round(nextPlayer.overload)}%`);
      trailVisible = drawAttackTrail(trail, accent, attackTelegraph);
      drawChargeIndicator(chargeIndicator, chargeState, accent, isLocal);

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
