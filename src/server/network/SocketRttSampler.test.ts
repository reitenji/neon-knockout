import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkProbe, NetworkProbeAcknowledgement } from '../../shared/protocol.js';
import { SocketRttSampler } from './SocketRttSampler.js';

type Delivery = Readonly<{
  probe: NetworkProbe;
  acknowledge: (acknowledgement: NetworkProbeAcknowledgement) => void;
}>;

function harness() {
  let now = 0;
  const deliveries: Delivery[] = [];
  const samples: Array<{ rttMs: number; sampledAtMs: number }> = [];
  let unavailableCount = 0;
  const sampler = new SocketRttSampler({
    now: () => now,
    send: (probe, acknowledge) => deliveries.push({ probe, acknowledge }),
    onSample: (sample) => samples.push(sample),
    onUnavailable: () => { unavailableCount += 1; }
  });
  return {
    sampler,
    deliveries,
    samples,
    get unavailableCount() { return unavailableCount; },
    advance(milliseconds: number): void {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    }
  };
}

describe('SocketRttSampler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps one probe outstanding and starts the next sample no sooner than one second after the prior send', () => {
    const subject = harness();

    subject.sampler.start();
    subject.sampler.start();
    subject.advance(12);
    subject.deliveries[0]!.acknowledge({ nonce: 1 });
    subject.advance(987);

    expect(subject.deliveries.map(({ probe }) => probe)).toEqual([{ nonce: 1 }]);
    subject.advance(1);
    expect(subject.deliveries.map(({ probe }) => probe)).toEqual([{ nonce: 1 }, { nonce: 2 }]);
    subject.advance(999);
    expect(subject.deliveries).toHaveLength(2);
  });

  it('ignores wrong and duplicate nonce acknowledgements', () => {
    const subject = harness();

    subject.sampler.start();
    subject.advance(7);
    subject.deliveries[0]!.acknowledge(null as unknown as NetworkProbeAcknowledgement);
    subject.deliveries[0]!.acknowledge({ nonce: 999 });
    expect(subject.samples).toEqual([]);
    expect(subject.deliveries).toHaveLength(1);

    subject.advance(4);
    subject.deliveries[0]!.acknowledge({ nonce: 1 });
    subject.deliveries[0]!.acknowledge({ nonce: 1 });

    expect(subject.samples).toEqual([{ rttMs: 11, sampledAtMs: 11 }]);
  });

  it('clears an unavailable sample after two seconds and recovers without publishing a fake capped RTT', () => {
    const subject = harness();

    subject.sampler.start();
    subject.advance(1_999);
    expect(subject.unavailableCount).toBe(0);
    expect(subject.samples).toEqual([]);
    expect(subject.deliveries).toHaveLength(1);

    subject.advance(1);
    expect(subject.unavailableCount).toBe(1);
    expect(subject.samples).toEqual([]);
    expect(subject.deliveries.map(({ probe }) => probe)).toEqual([{ nonce: 1 }, { nonce: 2 }]);

    subject.advance(8);
    subject.deliveries[1]!.acknowledge({ nonce: 2 });
    expect(subject.samples).toEqual([{ rttMs: 8, sampledAtMs: 2_008 }]);
  });

  it('invalidates pending acknowledgements and timers across stop and restart', () => {
    const subject = harness();

    subject.sampler.start();
    const staleAcknowledgement = subject.deliveries[0]!.acknowledge;
    subject.advance(5);
    subject.sampler.stop();
    subject.sampler.start();
    staleAcknowledgement({ nonce: 1 });
    subject.advance(9);
    subject.deliveries[1]!.acknowledge({ nonce: 2 });

    expect(subject.samples).toEqual([{ rttMs: 9, sampledAtMs: 14 }]);
    subject.advance(1_986);
    expect(subject.unavailableCount).toBe(0);
  });
});
