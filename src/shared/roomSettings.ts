export const MATCH_DURATION_OPTIONS = [90_000, 120_000, 180_000] as const;
export type MatchDurationMs = (typeof MATCH_DURATION_OPTIONS)[number];

export const KNOCKOUT_TARGET_OPTIONS = [3, 5, 7, 10] as const;
export type KnockoutTarget = (typeof KNOCKOUT_TARGET_OPTIONS)[number];

export type RoomSettings = Readonly<{
  durationMs: MatchDurationMs;
  knockoutTarget: KnockoutTarget;
}>;

export type MatchTiming = Readonly<{
  regulationMs: number;
  contractionWarningRemainingMs: number;
  contractionStartRemainingMs: number;
  contractionMinimumRemainingMs: number;
}>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = Object.freeze({
  durationMs: 120_000,
  knockoutTarget: 5
});

export function matchTimingFor(durationMs: MatchDurationMs): MatchTiming {
  return {
    regulationMs: durationMs,
    contractionWarningRemainingMs: durationMs * 13 / 20,
    contractionStartRemainingMs: durationMs * 5 / 8,
    contractionMinimumRemainingMs: durationMs / 3
  };
}
