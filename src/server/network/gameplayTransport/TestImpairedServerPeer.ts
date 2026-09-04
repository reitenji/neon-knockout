import type { RtcAnswer, RtcOffer } from '../../../shared/gameplayTransport.js';
import type {
  PeerSendResult,
  ServerPeer,
  ServerPeerFactory,
  TransportImpairment,
  TransportImpairmentResolver
} from './ServerPeer.js';

type MessageListener = (serialized: string) => void;
type ClosedListener = () => void;
type ChannelKind = 'fast' | 'reliable';
type StreamId = `${ChannelKind}-${'inbound' | 'outbound'}`;
type PendingPacket = Readonly<{
  kind: ChannelKind;
  outbound: boolean;
  serialized: string;
  deliverAtMs: number;
  reorderWindow: number;
}>;
type StreamRuntime = {
  pending: PendingPacket[];
  jitterIndex: number;
  attempted: number;
  lastOrderedDeliveryAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  timerDueAtMs: number | null;
};

const STREAM_IDS: readonly StreamId[] = [
  'fast-inbound',
  'fast-outbound',
  'reliable-inbound',
  'reliable-outbound'
];
const REORDER_PARTIAL_FLUSH_MS = Math.ceil(1_000 / 60);

function clampPacketDelay(baseDelayMs: number, jitterMs: number): number {
  return Math.max(0, Math.round(baseDelayMs + jitterMs));
}

function normalizedImpairment(impairment: TransportImpairment): TransportImpairment {
  return {
    oneWayDelayMs: Number.isFinite(impairment.oneWayDelayMs)
      ? Math.max(0, impairment.oneWayDelayMs)
      : 0,
    jitterSequenceMs: impairment.jitterSequenceMs.map((value) => Number.isFinite(value) ? value : 0),
    dropEveryNthPacket: impairment.dropEveryNthPacket !== null && impairment.dropEveryNthPacket > 0
      ? Math.max(1, Math.trunc(impairment.dropEveryNthPacket))
      : null,
    reorderWindow: Number.isFinite(impairment.reorderWindow)
      ? Math.max(0, Math.trunc(impairment.reorderWindow))
      : 0
  };
}

function createStreamRuntime(): StreamRuntime {
  return {
    pending: [],
    jitterIndex: 0,
    attempted: 0,
    lastOrderedDeliveryAtMs: 0,
    timer: null,
    timerDueAtMs: null
  };
}

export class TestImpairedServerPeer implements ServerPeer {
  readonly generationId: string;
  private readonly fastListeners = new Set<MessageListener>();
  private readonly reliableListeners = new Set<MessageListener>();
  private readonly closedListeners = new Set<ClosedListener>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly streams = new Map<StreamId, StreamRuntime>(STREAM_IDS.map((id) => [id, createStreamRuntime()]));
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly options: Readonly<{
      delegate: ServerPeer;
      impairment: TransportImpairment | TransportImpairmentResolver;
      now?: () => number;
    }>
  ) {
    this.generationId = options.delegate.generationId;
    this.unsubscribers.push(
      options.delegate.onFastMessage((serialized) => this.enqueueInbound('fast', serialized)),
      options.delegate.onReliableMessage((serialized) => this.enqueueInbound('reliable', serialized)),
      options.delegate.onClosed(() => this.acceptClosed())
    );
  }

  async negotiate(offer: RtcOffer): Promise<RtcAnswer> {
    return this.options.delegate.negotiate(offer);
  }

  isReady(): boolean {
    if (this.closed) return false;
    try {
      return this.options.delegate.isReady();
    } catch {
      return false;
    }
  }

  sendFast(serialized: string): PeerSendResult {
    return this.enqueueOutbound('fast', serialized);
  }

  sendReliable(serialized: string): PeerSendResult {
    return this.enqueueOutbound('reliable', serialized);
  }

  onFastMessage(listener: MessageListener): () => void {
    return this.addListener(this.fastListeners, listener);
  }

  onReliableMessage(listener: MessageListener): () => void {
    return this.addListener(this.reliableListeners, listener);
  }

  onClosed(listener: ClosedListener): () => void {
    return this.addListener(this.closedListeners, listener);
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true;
      this.clearTimers();
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
      this.closePromise = this.options.delegate.close().finally(() => {
        this.fastListeners.clear();
        this.reliableListeners.clear();
        this.closedListeners.clear();
      });
    }
    return this.closePromise;
  }

  private enqueueOutbound(kind: ChannelKind, serialized: string): PeerSendResult {
    const impairment = this.resolveImpairment(kind, 'outbound');
    if (impairment === null) {
      return kind === 'fast'
        ? this.options.delegate.sendFast(serialized)
        : this.options.delegate.sendReliable(serialized);
    }
    if (!this.isReady()) return 'closed';
    this.enqueue(`${kind}-outbound`, { kind, outbound: true, serialized }, impairment);
    return 'sent';
  }

  private enqueueInbound(kind: ChannelKind, serialized: string): void {
    if (this.closed) return;
    const impairment = this.resolveImpairment(kind, 'inbound');
    if (impairment === null) {
      this.deliverInbound(kind, serialized);
      return;
    }
    this.enqueue(`${kind}-inbound`, { kind, outbound: false, serialized }, impairment);
  }

  private enqueue(
    streamId: StreamId,
    packet: Readonly<{ kind: ChannelKind; outbound: boolean; serialized: string }>,
    impairment: TransportImpairment
  ): void {
    const stream = this.streams.get(streamId)!;
    const packetNumber = ++stream.attempted;
    if (this.shouldDrop(packetNumber, impairment)) return;
    const candidateDeliverAtMs = this.now() + this.packetDelayMs(stream, impairment);
    const deliverAtMs = impairment.reorderWindow > 0
      ? candidateDeliverAtMs
      : Math.max(stream.lastOrderedDeliveryAtMs, candidateDeliverAtMs);
    stream.lastOrderedDeliveryAtMs = deliverAtMs;
    stream.pending.push({
      ...packet,
      deliverAtMs,
      reorderWindow: impairment.reorderWindow
    });
    this.schedule(streamId);
  }

  private packetDelayMs(stream: StreamRuntime, impairment: TransportImpairment): number {
    const jitterSequence = impairment.jitterSequenceMs;
    const jitterMs = jitterSequence.length === 0
      ? 0
      : jitterSequence[stream.jitterIndex++ % jitterSequence.length] ?? 0;
    return clampPacketDelay(impairment.oneWayDelayMs, jitterMs);
  }

  private shouldDrop(packetNumber: number, impairment: TransportImpairment): boolean {
    const nth = impairment.dropEveryNthPacket;
    return nth !== null && nth > 0 && packetNumber % nth === 0;
  }

  private schedule(streamId: StreamId): void {
    const stream = this.streams.get(streamId)!;
    if (this.closed || stream.pending.length === 0) return;
    const nextDeliverAtMs = this.nextDeliveryAt(stream);
    if (stream.timer !== null && stream.timerDueAtMs !== null && stream.timerDueAtMs <= nextDeliverAtMs) return;
    if (stream.timer !== null) clearTimeout(stream.timer);
    const waitMs = Math.max(0, nextDeliverAtMs - this.now());
    stream.timerDueAtMs = nextDeliverAtMs;
    stream.timer = setTimeout(() => {
      stream.timer = null;
      stream.timerDueAtMs = null;
      this.flush(streamId);
    }, waitMs);
  }

  private flush(streamId: StreamId): void {
    const stream = this.streams.get(streamId)!;
    if (this.closed) {
      stream.pending = [];
      return;
    }
    const nowMs = this.now();
    while (!this.closed && stream.pending.length > 0) {
      const first = stream.pending[0]!;
      const groupSize = first.reorderWindow + 1;
      if (first.reorderWindow === 0) {
        if (first.deliverAtMs > nowMs) break;
        stream.pending.shift();
        this.deliver(first);
        continue;
      }

      const group = stream.pending.slice(0, groupSize);
      const fullGroup = group.length === groupSize;
      const readyAtMs = fullGroup
        ? Math.max(...group.map((packet) => packet.deliverAtMs))
        : Math.max(
            ...group.map((packet) => packet.deliverAtMs),
            first.deliverAtMs + REORDER_PARTIAL_FLUSH_MS
          );
      if (readyAtMs > nowMs) break;
      stream.pending.splice(0, group.length);
      for (const packet of [...group].reverse()) {
        if (this.closed) break;
        this.deliver(packet);
      }
    }
    if (stream.pending.length > 0) this.schedule(streamId);
  }

  private deliver(packet: PendingPacket): void {
    if (packet.outbound) {
      const result = packet.kind === 'fast'
        ? this.options.delegate.sendFast(packet.serialized)
        : this.options.delegate.sendReliable(packet.serialized);
      if (result === 'closed' || (packet.kind === 'reliable' && result === 'backpressured')) {
        this.acceptClosed();
      }
      return;
    }
    this.deliverInbound(packet.kind, packet.serialized);
  }

  private deliverInbound(kind: ChannelKind, serialized: string): void {
    if (this.closed) return;
    const listeners = kind === 'fast' ? this.fastListeners : this.reliableListeners;
    for (const listener of [...listeners]) listener(serialized);
  }

  private addListener<T>(listeners: Set<T>, listener: T): () => void {
    if (this.closed) return () => undefined;
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  private acceptClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    for (const listener of [...this.closedListeners]) listener();
  }

  private resolveImpairment(
    channel: ChannelKind,
    direction: 'inbound' | 'outbound'
  ): TransportImpairment | null {
    const configured = typeof this.options.impairment === 'function'
      ? this.options.impairment({ generationId: this.generationId, channel, direction })
      : this.options.impairment;
    return configured === null ? null : normalizedImpairment(configured);
  }

  private nextDeliveryAt(stream: StreamRuntime): number {
    const first = stream.pending[0]!;
    if (first.reorderWindow === 0) return first.deliverAtMs;
    const group = stream.pending.slice(0, first.reorderWindow + 1);
    if (group.length === first.reorderWindow + 1) {
      return Math.max(...group.map((packet) => packet.deliverAtMs));
    }
    return Math.max(
      ...group.map((packet) => packet.deliverAtMs),
      first.deliverAtMs + REORDER_PARTIAL_FLUSH_MS
    );
  }

  private clearTimers(): void {
    for (const stream of this.streams.values()) {
      if (stream.timer) clearTimeout(stream.timer);
      stream.timer = null;
      stream.timerDueAtMs = null;
      stream.pending = [];
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export function createTestImpairedPeerFactory(
  delegateFactory: ServerPeerFactory,
  impairment: TransportImpairment | TransportImpairmentResolver,
  now?: () => number
): ServerPeerFactory {
  return (options) => new TestImpairedServerPeer({
    delegate: delegateFactory(options),
    impairment,
    now
  });
}
