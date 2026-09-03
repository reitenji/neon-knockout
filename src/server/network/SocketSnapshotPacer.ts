import type { MatchSnapshotPublication } from '../../shared/gameplayTransport.js';

type SnapshotSender = (publication: MatchSnapshotPublication, acknowledge: () => void) => void;
type SnapshotRttSample = Readonly<{ rttMs: number; sampledAtMs: number }>;
type SocketSnapshotPacerOptions = Readonly<{
  now?: () => number;
  shouldSampleRtt?: () => boolean;
  onRttSample?: (sample: SnapshotRttSample) => void;
}>;

const RTT_SAMPLE_INTERVAL_MS = 1_000;

export class SocketSnapshotPacer {
  private activeDeliveryId: number | null = null;
  private nextDeliveryId = 0;
  private pending: MatchSnapshotPublication | null = null;
  private disposed = false;
  private nextRttSampleAtMs = 0;
  private readonly now: () => number;
  private readonly shouldSampleRtt: () => boolean;
  private readonly onRttSample: ((sample: SnapshotRttSample) => void) | null;

  constructor(private readonly send: SnapshotSender, options: SocketSnapshotPacerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.shouldSampleRtt = options.shouldSampleRtt ?? (() => true);
    this.onRttSample = options.onRttSample ?? null;
  }

  publish(publication: MatchSnapshotPublication): void {
    if (this.disposed) return;
    if (this.activeDeliveryId !== null) {
      this.pending = publication;
      return;
    }
    this.deliver(publication);
  }

  dispose(): void {
    this.disposed = true;
    this.activeDeliveryId = null;
    this.pending = null;
  }

  resetRttSampleWindow(): void {
    this.nextRttSampleAtMs = 0;
  }

  private deliver(publication: MatchSnapshotPublication): void {
    const deliveryId = ++this.nextDeliveryId;
    const startedAtMs = this.now();
    this.activeDeliveryId = deliveryId;
    this.send(publication, () => {
      if (this.disposed || this.activeDeliveryId !== deliveryId) return;
      const sampledAtMs = this.now();
      if (
        this.onRttSample !== null
        && sampledAtMs >= this.nextRttSampleAtMs
        && this.shouldSampleRtt()
      ) {
        this.nextRttSampleAtMs = sampledAtMs + RTT_SAMPLE_INTERVAL_MS;
        this.onRttSample?.({ rttMs: Math.max(0, sampledAtMs - startedAtMs), sampledAtMs });
      }
      this.activeDeliveryId = null;
      const pending = this.pending;
      this.pending = null;
      if (pending !== null) this.deliver(pending);
    });
  }
}
