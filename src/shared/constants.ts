import type { Chassis, Vec2 } from './model.js';

const freezePoint = (point: Vec2): Readonly<Vec2> => Object.freeze(point);

const freezePoints = (points: readonly Vec2[]): readonly Readonly<Vec2>[] =>
  Object.freeze(points.map((point) => freezePoint(point)));

export const CHASSIS_ORDER: readonly Chassis[] = Object.freeze(['RIFT', 'BASTION', 'PULSE', 'WRAITH']);

export const ACCENT_PALETTE = Object.freeze([
  '#6EE7F2',
  '#FF8A5B',
  '#9EF25B',
  '#F6D743',
  '#FF5FA2',
  '#7CB8FF',
  '#B78CFF',
  '#F4F7FB'
]);

export const GAME = Object.freeze({
  tickRate: 60,
  snapshotRate: 30,
  countdownMs: 3_000,
  regulationMs: 120_000,
  contractionWarningLeadMs: 30_000,
  contractionWarningMs: 3_000,
  contractionDurationMs: 17_000,
  targetScore: 5,
  reconnectGraceMs: 20_000,
  maxPlayers: 8,
  collisionRadius: 24,
  maxGroundSpeed: 330,
  groundAcceleration: 2_400,
  groundDrag: 1_950,
  dashSpeed: 760,
  dashDurationMs: 140,
  dashInvulnerabilityMs: 100,
  dashCooldownMs: 1_100,
  maxOverload: 150,
  knockoutToControlMs: 700,
  respawnProtectionMs: 650,
  reconnectWarpMs: 180,
  voidRecoverySteerMultiplier: 0.45,
  voidPullAcceleration: 360,
  knockoutDistance: 80,
  quickBufferMs: 120,
  heavyEnterChargeMs: 180,
  heavyMaxChargeMs: 700,
  heavyChargeMoveMultiplier: 0.55,
  heavyWindupMs: 110,
  heavyActiveMs: 90,
  heavyRecoveryMs: 320,
  quickCombo: Object.freeze([
    Object.freeze({
      step: 1,
      range: 72,
      arcDeg: 92,
      overloadGain: 8,
      baseImpulse: 280,
      windupMs: 70,
      activeMs: 60,
      recoveryMs: 100
    }),
    Object.freeze({
      step: 2,
      range: 76,
      arcDeg: 96,
      overloadGain: 10,
      baseImpulse: 325,
      windupMs: 65,
      activeMs: 65,
      recoveryMs: 120
    }),
    Object.freeze({
      step: 3,
      range: 88,
      arcDeg: 105,
      overloadGain: 16,
      baseImpulse: 455,
      windupMs: 115,
      activeMs: 70,
      recoveryMs: 205
    })
  ]),
  heavyAttack: Object.freeze({
    range: 94,
    arcDeg: 82,
    minOverloadGain: 18,
    maxOverloadGain: 32,
    minImpulse: 460,
    maxImpulse: 760
  })
});

export const ARENA = Object.freeze({
  width: 1_280,
  height: 720,
  regulationVertices: freezePoints([
    { x: 230, y: 90 },
    { x: 1050, y: 90 },
    { x: 1140, y: 180 },
    { x: 1140, y: 540 },
    { x: 1050, y: 630 },
    { x: 230, y: 630 },
    { x: 140, y: 540 },
    { x: 140, y: 180 }
  ]),
  minimumVertices: freezePoints([
    { x: 330, y: 150 },
    { x: 950, y: 150 },
    { x: 1020, y: 220 },
    { x: 1020, y: 500 },
    { x: 950, y: 570 },
    { x: 330, y: 570 },
    { x: 260, y: 500 },
    { x: 260, y: 220 }
  ]),
  spawnAnchors: freezePoints([
    { x: 640, y: 190 },
    { x: 860, y: 260 },
    { x: 930, y: 360 },
    { x: 860, y: 470 },
    { x: 640, y: 540 },
    { x: 420, y: 470 },
    { x: 350, y: 360 },
    { x: 420, y: 260 }
  ])
});
