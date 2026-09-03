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

});
