import { describe, expect, it } from 'vitest';
import { AdaptiveNetcodePolicy } from './netcodePolicy.js';

describe('AdaptiveNetcodePolicy', () => {
  it('uses the neutral budget when the server network status is absent', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: null,
      transportJitterMs: null,
      arrivalJitterMs: 80,
      bufferUnderrun: false,
      sampledAtMs: 1_000
    })).toEqual({ delayFrames: 1, rollbackFrames: 4 });
  });

  it('converts fresh RTT and the larger jitter source into the approved frame budget', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 20,
      arrivalJitterMs: 6,
      bufferUnderrun: false,
      sampledAtMs: 1_000
    })).toEqual({ delayFrames: 3, rollbackFrames: 9 });
  });

  it('raises the budget immediately when transport jitter spikes', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: 20,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 1_000
    })).toEqual({ delayFrames: 1, rollbackFrames: 4 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 20,
      arrivalJitterMs: 6,
      bufferUnderrun: false,
      sampledAtMs: 1_100
    })).toEqual({ delayFrames: 3, rollbackFrames: 9 });
  });

  it('requires two post-spike fresh samples before lowering a jitter-only increase', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: 20,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 0
    })).toEqual({ delayFrames: 1, rollbackFrames: 4 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 20,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 100
    })).toEqual({ delayFrames: 3, rollbackFrames: 9 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 2_100
    })).toEqual({ delayFrames: 3, rollbackFrames: 9 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 2_200
    })).toEqual({ delayFrames: 2, rollbackFrames: 8 });
  });

  it('raises presentation delay immediately when the buffer underruns', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: 20,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: true,
      sampledAtMs: 1_000
    })).toEqual({ delayFrames: 2, rollbackFrames: 4 });
  });

  it('lowers each budget by only one frame after two stable fresh samples and two underrun-free seconds', () => {
    const policy = new AdaptiveNetcodePolicy();

    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 70,
      arrivalJitterMs: 0,
      bufferUnderrun: true,
      sampledAtMs: 0
    })).toEqual({ delayFrames: 5, rollbackFrames: 10 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 1_000
    })).toEqual({ delayFrames: 5, rollbackFrames: 10 });
    expect(policy.update({
      medianRttMs: 100,
      transportJitterMs: 0,
      arrivalJitterMs: 0,
      bufferUnderrun: false,
      sampledAtMs: 2_000
    })).toEqual({ delayFrames: 4, rollbackFrames: 9 });
  });

  it('resets a raised budget to neutral', () => {
    const policy = new AdaptiveNetcodePolicy();
    policy.update({
      medianRttMs: 100,
      transportJitterMs: 70,
      arrivalJitterMs: 0,
      bufferUnderrun: true,
      sampledAtMs: 0
    });

    expect(policy.reset()).toEqual({ delayFrames: 1, rollbackFrames: 4 });
  });
});
