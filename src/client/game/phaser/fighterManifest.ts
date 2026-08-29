import type { Chassis } from '../../../shared/model.js';

export type FighterAssetSet = Readonly<{
  body: string;
  leftArm: string;
  rightArm: string;
  core: string;
  scale: number;
}>;

export const FIGHTER_MANIFEST: Readonly<Record<Chassis, FighterAssetSet>> = Object.freeze({
  RIFT: Object.freeze({
    body: '/assets/fighters/rift/body.svg',
    leftArm: '/assets/fighters/rift/left-arm.svg',
    rightArm: '/assets/fighters/rift/right-arm.svg',
    core: '/assets/fighters/rift/core.svg',
    scale: 0.81
  }),
  BASTION: Object.freeze({
    body: '/assets/fighters/bastion/body.svg',
    leftArm: '/assets/fighters/bastion/left-arm.svg',
    rightArm: '/assets/fighters/bastion/right-arm.svg',
    core: '/assets/fighters/bastion/core.svg',
    scale: 0.83
  }),
  PULSE: Object.freeze({
    body: '/assets/fighters/pulse/body.svg',
    leftArm: '/assets/fighters/pulse/left-arm.svg',
    rightArm: '/assets/fighters/pulse/right-arm.svg',
    core: '/assets/fighters/pulse/core.svg',
    scale: 0.78
  }),
  WRAITH: Object.freeze({
    body: '/assets/fighters/wraith/body.svg',
    leftArm: '/assets/fighters/wraith/left-arm.svg',
    rightArm: '/assets/fighters/wraith/right-arm.svg',
    core: '/assets/fighters/wraith/core.svg',
    scale: 0.82
  })
});

export type FighterAssetPart = 'body' | 'leftArm' | 'rightArm' | 'core';

export function fighterTextureKey(chassis: Chassis, part: FighterAssetPart): string {
  return `fighter-${chassis.toLowerCase()}-${part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
