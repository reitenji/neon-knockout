// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerSendResult, ServerPeer } from './ServerPeer.js';
import { createTestImpairedPeerFactory, TestImpairedServerPeer } from './TestImpairedServerPeer.js';

type MessageListener = (serialized: string) => void;

class FakePeer implements ServerPeer {
  readonly fastSent: string[] = [];
  readonly reliableSent: string[] = [];
  readonly fastListeners = new Set<MessageListener>();
  readonly reliableListeners = new Set<MessageListener>();
  readonly closedListeners = new Set<() => void>();
  fastResult: PeerSendResult = 'sent';
  reliableResult: PeerSendResult = 'sent';
  closeCalls = 0;
  ready = true;

  constructor(readonly generationId: string) {}

  async negotiate(): Promise<{ type: 'answer'; sdp: string }> {
    return { type: 'answer', sdp: 'unused-answer' };
  }

  isReady(): boolean {
    return this.ready;
  }

  sendFast(serialized: string): PeerSendResult {
    if (this.fastResult === 'sent') this.fastSent.push(serialized);
    return this.fastResult;
  }

  sendReliable(serialized: string): PeerSendResult {
    if (this.reliableResult === 'sent') this.reliableSent.push(serialized);
    return this.reliableResult;
  }

  onFastMessage(listener: MessageListener): () => void {
    this.fastListeners.add(listener);
    return () => this.fastListeners.delete(listener);
  }

  onReliableMessage(listener: MessageListener): () => void {
    this.reliableListeners.add(listener);
    return () => this.reliableListeners.delete(listener);
  }

  onClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.ready = false;
  }

  receiveFast(serialized: string): void {
    for (const listener of [...this.fastListeners]) listener(serialized);
  }

  receiveReliable(serialized: string): void {
    for (const listener of [...this.reliableListeners]) listener(serialized);
  }

  failClosed(): void {
    this.ready = false;
    for (const listener of [...this.closedListeners]) listener();
  }
}

describe('TestImpairedServerPeer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('applies the configured one-way delay to both probe and acknowledgement legs on the same peer', async () => {
    const delegate = new FakePeer('generation-1');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 12,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });
    const inbound: Array<{ serialized: string; deliveredAtMs: number }> = [];
    peer.onFastMessage((serialized) => inbound.push({ serialized, deliveredAtMs: Date.now() }));

    expect(peer.sendFast('probe')).toBe('sent');
    expect(delegate.fastSent).toEqual([]);
    expect(inbound).toEqual([]);

    await vi.advanceTimersByTimeAsync(11);
    expect(delegate.fastSent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(delegate.fastSent).toEqual(['probe']);

    delegate.receiveFast('probe-ack');
    await vi.advanceTimersByTimeAsync(11);
    expect(inbound).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(inbound).toEqual([{ serialized: 'probe-ack', deliveredAtMs: 24 }]);
  });

  it('repeats the configured jitter sequence for successive reliable packets', async () => {
    const delegate = new FakePeer('generation-2');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [0, 5],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });

    expect(peer.sendReliable('first')).toBe('sent');
    expect(peer.sendReliable('second')).toBe('sent');
    expect(peer.sendReliable('third')).toBe('sent');

    await vi.advanceTimersByTimeAsync(10);
    expect(delegate.reliableSent).toEqual(['first']);

    await vi.advanceTimersByTimeAsync(5);
    expect(delegate.reliableSent).toEqual(['first', 'second', 'third']);
  });

  it('clamps signed jitter to a nonnegative transit delay and repeats it independently by direction', async () => {
    const delegate = new FakePeer('generation-signed-jitter');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [-20, 5],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });
    const inbound: string[] = [];
    peer.onFastMessage((serialized) => inbound.push(serialized));

    expect(peer.sendFast('out-1')).toBe('sent');
    delegate.receiveFast('in-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(delegate.fastSent).toEqual(['out-1']);
    expect(inbound).toEqual(['in-1']);

    expect(peer.sendFast('out-2')).toBe('sent');
    delegate.receiveFast('in-2');
    await vi.advanceTimersByTimeAsync(14);
    expect(delegate.fastSent).toEqual(['out-1']);
    expect(inbound).toEqual(['in-1']);
    await vi.advanceTimersByTimeAsync(1);
    expect(delegate.fastSent).toEqual(['out-1', 'out-2']);
    expect(inbound).toEqual(['in-1', 'in-2']);
  });

  it('drops every nth packet deterministically in both directions without surfacing a transport error', async () => {
    const delegate = new FakePeer('generation-3');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 0,
        jitterSequenceMs: [],
        dropEveryNthPacket: 2,
        reorderWindow: 0
      }
    });
    const inbound: string[] = [];
    peer.onReliableMessage((serialized) => inbound.push(serialized));

    expect(peer.sendReliable('one')).toBe('sent');
    expect(peer.sendReliable('two')).toBe('sent');
    expect(peer.sendReliable('three')).toBe('sent');
    delegate.receiveReliable('alpha');
    delegate.receiveReliable('beta');
    delegate.receiveReliable('gamma');

    await vi.runAllTimersAsync();

    expect(delegate.reliableSent).toEqual(['one', 'three']);
    expect(inbound).toEqual(['alpha', 'gamma']);
  });

  it('reorders only within the configured bounded window', async () => {
    const delegate = new FakePeer('generation-4');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 1
      }
    });
    const inbound: string[] = [];
    peer.onFastMessage((serialized) => inbound.push(serialized));

    expect(peer.sendFast('first')).toBe('sent');
    expect(peer.sendFast('second')).toBe('sent');
    expect(peer.sendFast('third')).toBe('sent');
    delegate.receiveFast('alpha');
    delegate.receiveFast('beta');
    delegate.receiveFast('gamma');

    await vi.advanceTimersByTimeAsync(10);

    expect(delegate.fastSent).toEqual(['second', 'first']);
    expect(inbound).toEqual(['beta', 'alpha']);
    await vi.advanceTimersByTimeAsync(17);
    expect(delegate.fastSent).toEqual(['second', 'first', 'third']);
    expect(inbound).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('holds a packet long enough to reorder adjacent packets that arrive on separate ticks', async () => {
    const delegate = new FakePeer('generation-reorder-ticks');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 1
      }
    });

    expect(peer.sendFast('first')).toBe('sent');
    await vi.advanceTimersByTimeAsync(5);
    expect(peer.sendFast('second')).toBe('sent');
    await vi.advanceTimersByTimeAsync(10);

    expect(delegate.fastSent).toEqual(['second', 'first']);
  });

  it('can resolve different deterministic impairment for each peer direction', async () => {
    const delegate = new FakePeer('generation-directional');
    const factory = createTestImpairedPeerFactory(
      () => delegate,
      ({ direction }) => ({
        oneWayDelayMs: direction === 'outbound' ? 7 : 19,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      })
    );
    const peer = factory({ generationId: delegate.generationId, udpPortRange: [54100, 54131] });
    const inbound: string[] = [];
    peer.onFastMessage((serialized) => inbound.push(serialized));

    expect(peer.sendFast('outbound')).toBe('sent');
    delegate.receiveFast('inbound');
    await vi.advanceTimersByTimeAsync(7);
    expect(delegate.fastSent).toEqual(['outbound']);
    expect(inbound).toEqual([]);
    await vi.advanceTimersByTimeAsync(12);
    expect(inbound).toEqual(['inbound']);
  });

  it('returns closed before queueing when the delegate is not ready and preserves immediate pass-through results', async () => {
    const closedDelegate = new FakePeer('generation-5');
    closedDelegate.ready = false;
    const closedPeer = new TestImpairedServerPeer({
      delegate: closedDelegate,
      impairment: {
        oneWayDelayMs: 20,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });

    expect(closedPeer.sendFast('never-sent')).toBe('closed');
    await vi.runAllTimersAsync();
    expect(closedDelegate.fastSent).toEqual([]);

    const pressuredDelegate = new FakePeer('generation-6');
    pressuredDelegate.reliableResult = 'backpressured';
    const pressuredPeer = new TestImpairedServerPeer({
      delegate: pressuredDelegate,
      impairment: () => null
    });

    expect(pressuredPeer.sendReliable('buffered')).toBe('backpressured');
    await vi.runAllTimersAsync();
    expect(pressuredDelegate.reliableSent).toEqual([]);
  });

  it('preserves delivery-time fast drop and reliable fallback semantics when delegate pressure changes while queued', async () => {
    const fastDelegate = new FakePeer('generation-delayed-fast-pressure');
    const fastPeer = new TestImpairedServerPeer({
      delegate: fastDelegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });

    expect(fastPeer.sendFast('drop-on-pressure')).toBe('sent');
    fastDelegate.fastResult = 'backpressured';
    await vi.advanceTimersByTimeAsync(10);
    expect(fastDelegate.fastSent).toEqual([]);
    expect(fastPeer.isReady()).toBe(true);

    const reliableDelegate = new FakePeer('generation-delayed-reliable-pressure');
    const reliablePeer = new TestImpairedServerPeer({
      delegate: reliableDelegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });
    const closed = vi.fn();
    reliablePeer.onClosed(closed);
    expect(reliablePeer.sendReliable('fallback-on-pressure')).toBe('sent');
    reliableDelegate.reliableResult = 'backpressured';
    await vi.advanceTimersByTimeAsync(10);

    expect(reliableDelegate.reliableSent).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(reliablePeer.isReady()).toBe(false);
    expect(reliablePeer.sendReliable('after-close')).toBe('closed');

    const closedDelegate = new FakePeer('generation-delayed-closed');
    const closedPeer = new TestImpairedServerPeer({
      delegate: closedDelegate,
      impairment: {
        oneWayDelayMs: 10,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });
    const closedOnDelivery = vi.fn();
    closedPeer.onClosed(closedOnDelivery);
    expect(closedPeer.sendReliable('closed-on-delivery')).toBe('sent');
    closedDelegate.reliableResult = 'closed';
    await vi.advanceTimersByTimeAsync(10);

    expect(closedOnDelivery).toHaveBeenCalledTimes(1);
    expect(closedPeer.isReady()).toBe(false);
  });

  it('cancels every queued delivery and notifies closure once when closed before transit completes', async () => {
    const delegate = new FakePeer('generation-close-queued');
    const peer = new TestImpairedServerPeer({
      delegate,
      impairment: {
        oneWayDelayMs: 20,
        jitterSequenceMs: [],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    });
    const inbound: string[] = [];
    const closed = vi.fn();
    peer.onFastMessage((serialized) => inbound.push(serialized));
    peer.onClosed(closed);
    expect(peer.sendFast('queued-outbound')).toBe('sent');
    delegate.receiveFast('queued-inbound');

    delegate.failClosed();
    delegate.failClosed();
    await vi.runAllTimersAsync();

    expect(delegate.fastSent).toEqual([]);
    expect(inbound).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(1);
    await peer.close();
    await peer.close();
    expect(delegate.closeCalls).toBe(1);
  });
});
