export type AdaptiveNetcodeSample = Readonly<{
  medianRttMs: number | null;
  transportJitterMs: number | null;
  arrivalJitterMs: number;
  bufferUnderrun: boolean;
  sampledAtMs: number;
}>;

export type AdaptiveNetcodeBudget = Readonly<{
  delayFrames: number;
  rollbackFrames: number;
}>;

const TICK_MS = 1_000 / 60;
const NEUTRAL_BUDGET: AdaptiveNetcodeBudget = { delayFrames: 1, rollbackFrames: 4 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export class AdaptiveNetcodePolicy {
  private budget = NEUTRAL_BUDGET;
  private lastFreshSampleAtMs: number | null = null;
  private lastUnderrunAtMs: number | null = null;
  private stableFreshSamples = 0;

  update(sample: AdaptiveNetcodeSample): AdaptiveNetcodeBudget {
    if (sample.medianRttMs === null || sample.transportJitterMs === null) return this.reset();

    const jitterMs = Math.max(sample.transportJitterMs, sample.arrivalJitterMs * 1.5);
    let delayFrames = clamp(Math.ceil((TICK_MS + jitterMs) / TICK_MS), 1, 5);
    if (sample.bufferUnderrun) delayFrames = Math.max(delayFrames, Math.min(5, this.budget.delayFrames + 1));
    const rollbackFrames = clamp(
      Math.ceil((sample.medianRttMs / 2 + 2 * sample.transportJitterMs) / TICK_MS) + delayFrames,
      2,
      10
    );
    const target = { delayFrames, rollbackFrames };

    const hasNewFreshSample = this.lastFreshSampleAtMs !== sample.sampledAtMs;
    if (hasNewFreshSample) this.lastFreshSampleAtMs = sample.sampledAtMs;
    if (sample.bufferUnderrun) {
      this.lastUnderrunAtMs = sample.sampledAtMs;
      this.stableFreshSamples = 0;
    } else if (hasNewFreshSample) {
      this.stableFreshSamples += 1;
    }

    if (target.delayFrames > this.budget.delayFrames || target.rollbackFrames > this.budget.rollbackFrames) {
      this.budget = {
        delayFrames: Math.max(this.budget.delayFrames, target.delayFrames),
        rollbackFrames: Math.max(this.budget.rollbackFrames, target.rollbackFrames)
      };
      if (!sample.bufferUnderrun && hasNewFreshSample) this.stableFreshSamples = 0;
      return this.budget;
    }

    const underrunFreeForMs = this.lastUnderrunAtMs === null
      ? Number.POSITIVE_INFINITY
      : sample.sampledAtMs - this.lastUnderrunAtMs;
    if (this.stableFreshSamples >= 2 && underrunFreeForMs >= 2_000) {
      this.budget = {
        delayFrames: Math.max(target.delayFrames, this.budget.delayFrames - 1),
        rollbackFrames: Math.max(target.rollbackFrames, this.budget.rollbackFrames - 1)
      };
      this.stableFreshSamples = 0;
    }
    return this.budget;
  }

  reset(): AdaptiveNetcodeBudget {
    this.budget = NEUTRAL_BUDGET;
    this.lastFreshSampleAtMs = null;
    this.lastUnderrunAtMs = null;
    this.stableFreshSamples = 0;
    return this.budget;
  }
}
