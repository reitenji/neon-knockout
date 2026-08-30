import { describe, expect, it } from 'vitest';
import type { MatchAction } from '../../../shared/model.js';
import { LocalActionAudioTracker } from './LocalActionAudioTracker.js';

const quick = (kind: 'QUICK_1' | 'QUICK_2' | 'QUICK_3' = 'QUICK_1'): MatchAction => ({
  kind,
  phase: 'WINDUP',
  comboStep: kind === 'QUICK_1' ? 1 : kind === 'QUICK_2' ? 2 : 3,
  chargeMs: 0
});

const heavy = (chargeMs: number): MatchAction => ({
  kind: 'HEAVY',
  phase: 'WINDUP',
  comboStep: 0,
  chargeMs
});

const dash: MatchAction = {
  kind: 'DASH',
  phase: 'ACTIVE',
  comboStep: 0,
  chargeMs: 0
};

describe('LocalActionAudioTracker', () => {
  it('emits quick and dash only when their predicted action starts', () => {
    const tracker = new LocalActionAudioTracker();

    expect(tracker.consume(quick())).toEqual(['quick']);
    expect(tracker.consume(quick())).toEqual([]);
    expect(tracker.consume(null)).toEqual([]);
    expect(tracker.consume(quick('QUICK_2'))).toEqual(['quick']);
    expect(tracker.consume(null)).toEqual([]);
    expect(tracker.consume(dash)).toEqual(['dash']);
    expect(tracker.consume(dash)).toEqual([]);
  });

  it('emits one charge cue while held and one release cue after a committed charge', () => {
    const tracker = new LocalActionAudioTracker();

    expect(tracker.consume(heavy(16))).toEqual(['heavy-charge']);
    expect(tracker.consume(heavy(180))).toEqual([]);
    expect(tracker.consume(heavy(900))).toEqual([]);
    expect(tracker.consume(heavy(900))).toEqual([]);
    expect(tracker.consume(null)).toEqual(['heavy-release']);
    expect(tracker.consume(null)).toEqual([]);
  });

  it('does not emit release for a tap or a charge cancelled into dash', () => {
    const tracker = new LocalActionAudioTracker();

    expect(tracker.consume(heavy(100))).toEqual(['heavy-charge']);
    expect(tracker.consume(null)).toEqual([]);
    expect(tracker.consume(heavy(180))).toEqual(['heavy-charge']);
    expect(tracker.consume(dash)).toEqual(['dash']);
    expect(tracker.consume(null)).toEqual([]);
  });

  it('can reset without turning a held charge into a release', () => {
    const tracker = new LocalActionAudioTracker();

    tracker.consume(heavy(180));
    tracker.reset();

    expect(tracker.consume(null)).toEqual([]);
    expect(tracker.consume(quick())).toEqual(['quick']);
  });
});
