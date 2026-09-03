import type { MatchSnapshotPublication } from '../../shared/gameplayTransport.js';

type SnapshotSender = (publication: MatchSnapshotPublication, acknowledge: () => void) => void;

export class SocketSnapshotPacer {
  private activeDeliveryId: number | null = null;
  private nextDeliveryId = 0;
  private pending: MatchSnapshotPublication | null = null;
  private disposed = false;

  constructor(private readonly send: SnapshotSender) {}

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

  private deliver(publication: MatchSnapshotPublication): void {
    const deliveryId = ++this.nextDeliveryId;
    this.activeDeliveryId = deliveryId;
    this.send(publication, () => {
      if (this.disposed || this.activeDeliveryId !== deliveryId) return;
      this.activeDeliveryId = null;
      const pending = this.pending;
      this.pending = null;
      if (pending !== null) this.deliver(pending);
    });
  }
}
