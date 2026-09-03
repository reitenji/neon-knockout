import { describe, expect, it, vi } from 'vitest';
import type { MatchSnapshotPublication } from '../../shared/gameplayTransport.js';
import { SocketSnapshotPacer } from './SocketSnapshotPacer.js';

function publication(eventCursor: number): MatchSnapshotPublication {
  return {
    matchEpoch: 1,
    eventCursor,
    snapshot: {
      tick: eventCursor,
      phase: 'REGULATION',
      remainingMs: 10_000,
      platformProgress: 0,
      settings: { durationMs: 120_000, knockoutTarget: 5 },
      scores: {},
      network: {},
      players: [],
      pulses: [],
      winnerPlayerId: null,
      resultReason: null
    }
  };
}

describe('SocketSnapshotPacer', () => {
  it('sends the first publication immediately and releases only the latest pending publication after acknowledgement', () => {
    const deliveries: Array<{ publication: MatchSnapshotPublication; acknowledge: () => void }> = [];
    const pacer = new SocketSnapshotPacer((value, acknowledge) => deliveries.push({ publication: value, acknowledge }));

    pacer.publish(publication(1));
    pacer.publish(publication(2));
    pacer.publish(publication(3));

    expect(deliveries.map((delivery) => delivery.publication.eventCursor)).toEqual([1]);

    const firstAcknowledgement = deliveries[0]!.acknowledge;
    firstAcknowledgement();

    expect(deliveries.map((delivery) => delivery.publication.eventCursor)).toEqual([1, 3]);

    firstAcknowledgement();
    expect(deliveries.map((delivery) => delivery.publication.eventCursor)).toEqual([1, 3]);

    deliveries[1]!.acknowledge();
    expect(deliveries.map((delivery) => delivery.publication.eventCursor)).toEqual([1, 3]);
  });

  it('ignores stale acknowledgements and does not deliver after disposal', () => {
    const send = vi.fn<(value: MatchSnapshotPublication, acknowledge: () => void) => void>();
    const pacer = new SocketSnapshotPacer(send);

    pacer.publish(publication(1));
    const staleAcknowledgement = send.mock.calls[0]![1];
    pacer.publish(publication(2));
    staleAcknowledgement();
    const currentAcknowledgement = send.mock.calls[1]![1];
    pacer.publish(publication(3));
    pacer.dispose();

    currentAcknowledgement();
    staleAcknowledgement();
    pacer.publish(publication(4));

    expect(send.mock.calls.map(([value]) => value.eventCursor)).toEqual([1, 2]);
  });

  it('samples actual snapshot acknowledgement RTT at most once per second', () => {
    let now = 1_000;
    const samples: Array<{ rttMs: number; sampledAtMs: number }> = [];
    const deliveries: Array<{ publication: MatchSnapshotPublication; acknowledge: () => void }> = [];
    const pacer = new SocketSnapshotPacer(
      (value, acknowledge) => deliveries.push({ publication: value, acknowledge }),
      { now: () => now, onRttSample: (sample) => samples.push(sample) }
    );

    pacer.publish(publication(1));
    now = 1_017;
    deliveries[0]!.acknowledge();
    pacer.publish(publication(2));
    now = 1_025;
    deliveries[1]!.acknowledge();
    now = 1_999;
    pacer.publish(publication(3));
    deliveries[2]!.acknowledge();
    now = 2_000;
    pacer.publish(publication(4));
    now = 2_022;
    deliveries[3]!.acknowledge();

    expect(samples).toEqual([
      { rttMs: 17, sampledAtMs: 1_017 },
      { rttMs: 22, sampledAtMs: 2_022 }
    ]);
  });

  it('does not sample an acknowledgement from a disposed session', () => {
    const acknowledgements: Array<() => void> = [];
    const onRttSample = vi.fn();
    const pacer = new SocketSnapshotPacer(
      (_value, acknowledge) => acknowledgements.push(acknowledge),
      { now: () => 10, onRttSample }
    );

    pacer.publish(publication(1));
    pacer.dispose();
    acknowledgements[0]!();

    expect(onRttSample).not.toHaveBeenCalled();
  });

  it('does not consume the fallback sampling slot with an ineligible safety-copy acknowledgement', () => {
    let now = 100;
    let fallbackMode = false;
    const samples: Array<{ rttMs: number; sampledAtMs: number }> = [];
    const acknowledgements: Array<() => void> = [];
    const pacer = new SocketSnapshotPacer(
      (_value, acknowledge) => acknowledgements.push(acknowledge),
      {
        now: () => now,
        shouldSampleRtt: () => fallbackMode,
        onRttSample: (sample) => samples.push(sample)
      }
    );

    pacer.publish(publication(1));
    now = 110;
    acknowledgements[0]!();
    fallbackMode = true;
    pacer.publish(publication(2));
    now = 115;
    acknowledgements[1]!();

    expect(samples).toEqual([{ rttMs: 5, sampledAtMs: 115 }]);
  });

  it('resets the sampling window idempotently when gameplay falls back from WebRTC', () => {
    let now = 100;
    const samples: Array<{ rttMs: number; sampledAtMs: number }> = [];
    const acknowledgements: Array<() => void> = [];
    const pacer = new SocketSnapshotPacer(
      (_value, acknowledge) => acknowledgements.push(acknowledge),
      { now: () => now, onRttSample: (sample) => samples.push(sample) }
    );

    pacer.publish(publication(1));
    now = 110;
    acknowledgements[0]!();
    pacer.resetRttSampleWindow();
    pacer.resetRttSampleWindow();
    pacer.publish(publication(2));
    now = 115;
    acknowledgements[1]!();

    expect(samples).toEqual([
      { rttMs: 10, sampledAtMs: 110 },
      { rttMs: 5, sampledAtMs: 115 }
    ]);
  });
});
