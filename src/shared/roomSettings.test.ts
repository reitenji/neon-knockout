import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  KNOCKOUT_TARGET_OPTIONS,
  MATCH_DURATION_OPTIONS,
  matchTimingFor
} from './roomSettings.js';

describe('room settings', () => {
  it('exports the exact approved duration and knockout options with the default pair', () => {
    expect(MATCH_DURATION_OPTIONS).toEqual([90_000, 120_000, 180_000]);
    expect(KNOCKOUT_TARGET_OPTIONS).toEqual([3, 5, 7, 10]);
    expect(DEFAULT_ROOM_SETTINGS).toEqual({ durationMs: 120_000, knockoutTarget: 5 });
  });

  it.each([
    [90_000, 58_500, 56_250, 30_000],
    [120_000, 78_000, 75_000, 40_000],
    [180_000, 117_000, 112_500, 60_000]
  ] as const)(
    'derives stable contraction timing for %i ms regulation',
    (durationMs, contractionWarningRemainingMs, contractionStartRemainingMs, contractionMinimumRemainingMs) => {
      expect(matchTimingFor(durationMs)).toEqual({
        regulationMs: durationMs,
        contractionWarningRemainingMs,
        contractionStartRemainingMs,
        contractionMinimumRemainingMs
      });
    }
  );

  it('returns a fresh timing object without mutating the requested duration', () => {
    const durationMs = 120_000;
    const first = matchTimingFor(durationMs);
    const second = matchTimingFor(durationMs);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(durationMs).toBe(120_000);
  });
});
