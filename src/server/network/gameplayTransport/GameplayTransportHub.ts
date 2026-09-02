import {
  ACTIVATION_TIMEOUT_MS,
  GAMEPLAY_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  MISSED_HEARTBEATS_BEFORE_FALLBACK,
  RTT_FRESHNESS_MS,
  RTT_SAMPLE_INTERVAL_MS,
  RTT_SAMPLE_LIMIT,
  clientFastMessageSchema,
  clientReliableMessageSchema,
  rtcActivationRequestSchema,
  rtcNegotiationRequestSchema,
  type GameplayTransportMode,
  type MatchEventPublication,
  type MatchSnapshotPublication,
  type MatchStartedPublication,
  type RtcActivationRequest,
  type RtcNegotiationAnswer,
  type RtcNegotiationRequest,
  type ServerFastMessage,
  type ServerReliableMessage,
  type TransportModeNotice
} from '../../../shared/gameplayTransport.js';
import type { ServerError } from '../../../shared/model.js';
import type { MatchInputIngress } from '../matchInputIngress.js';
import type { ServerPeer, ServerPeerFactory } from './ServerPeer.js';

type SocketGameplayTransportMode = Exclude<GameplayTransportMode, 'webrtc'>;

export type TransportSession = Readonly<{
  socketId: string;
  playerId: string;
  roomCode: string;
  inputIngress: MatchInputIngress;
  socketMode(): SocketGameplayTransportMode;
  emitMode(notice: TransportModeNotice): void;
  emitStarted(publication: MatchStartedPublication): void;
  emitSnapshot(publication: MatchSnapshotPublication): void;
  emitEvent(publication: MatchEventPublication): void;
  emitError(error: ServerError): void;
  probeFallbackPing(): void;
  setNetworkMode(mode: GameplayTransportMode): void;
  setNetworkSample(medianMs: number, sampledAt: number): void;
  clearNetworkSample(): void;
}>;

export type TransportPublication =
  | Readonly<{ type: 'MATCH_STARTED'; roomCode: string } & MatchStartedPublication>
  | Readonly<{ type: 'MATCH_SNAPSHOT'; roomCode: string } & MatchSnapshotPublication>
  | Readonly<{ type: 'MATCH_EVENT'; roomCode: string } & MatchEventPublication>;

export type GameplayTransportHubOptions = Readonly<{
  peerFactory: ServerPeerFactory;
  udpPortRange: readonly [number, number];
  now?: () => number;
}>;

type RttSample = Readonly<{ value: number; sampledAt: number }>;
type RttSamplingOwner = Readonly<{ peer: ServerPeer; generationId: string }>;

type SessionRecord = {
  readonly session: TransportSession;
  mode: GameplayTransportMode;
  matchEpoch: number | null;
  generationId: string | null;
  peer: ServerPeer | null;
  activationExpiresAt: number | null;
  activationTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  rttTimer: ReturnType<typeof setInterval> | null;
  rttFreshnessTimer: ReturnType<typeof setTimeout> | null;
  heartbeatNonce: number;
  pendingHeartbeatNonce: number | null;
  missedHeartbeats: number;
  rttSamples: RttSample[];
  rttSampling: RttSamplingOwner | null;
  rttFresh: boolean;
  fallbackTriggered: boolean;
  negotiationSequence: number;
  unsubscribers: Array<() => void>;
  disposed: boolean;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle]!);
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function safeInvoke(callback: () => void): void {
  try {
    callback();
  } catch {
    // A detached Socket.IO or room callback must not affect another session.
  }
}

export class GameplayTransportNegotiationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameplayTransportNegotiationCancelledError';
  }
}

export class GameplayTransportHub {
  private readonly sessionsBySocket = new Map<string, SessionRecord>();
  private readonly sessionsByPlayer = new Map<string, SessionRecord>();
  private readonly peerClosures = new WeakMap<ServerPeer, Promise<void>>();
  private readonly pendingPeerClosures = new Set<Promise<void>>();
  private readonly now: () => number;
  private stopped = false;

  constructor(private readonly options: GameplayTransportHubOptions) {
    this.now = options.now ?? Date.now;
  }

  attachSession(session: TransportSession): void {
    if (this.stopped) throw new Error('Gameplay transport hub is stopped.');

    const socketRecord = this.sessionsBySocket.get(session.socketId);
    if (socketRecord) this.removeRecord(socketRecord);
    const playerRecord = this.sessionsByPlayer.get(session.playerId);
    if (playerRecord && playerRecord !== socketRecord) this.removeRecord(playerRecord);

    const record: SessionRecord = {
      session,
      mode: this.fallbackMode(session),
      matchEpoch: null,
      generationId: null,
      peer: null,
      activationExpiresAt: null,
      activationTimer: null,
      heartbeatTimer: null,
      rttTimer: null,
      rttFreshnessTimer: null,
      heartbeatNonce: 0,
      pendingHeartbeatNonce: null,
      missedHeartbeats: 0,
      rttSamples: [],
      rttSampling: null,
      rttFresh: false,
      fallbackTriggered: false,
      negotiationSequence: 0,
      unsubscribers: [],
      disposed: false
    };
    this.sessionsBySocket.set(session.socketId, record);
    this.sessionsByPlayer.set(session.playerId, record);
  }

  start(): void {
    this.stopped = false;
  }

  async negotiate(socketId: string, request: RtcNegotiationRequest): Promise<RtcNegotiationAnswer> {
    const record = this.requireSession(socketId);
    const parsed = rtcNegotiationRequestSchema.safeParse(request);
    if (!parsed.success) throw new Error('Invalid WebRTC negotiation request.');
    const sequence = ++record.negotiationSequence;

    const existingPeer = record.peer;
    if (existingPeer) {
      if (record.mode === 'webrtc') {
        await this.transitionToFallback(record, record.generationId, existingPeer);
      } else {
        await this.disposePeer(record, existingPeer);
      }
    }
    if (!this.isCurrentRecord(record) || record.negotiationSequence !== sequence) {
      throw new GameplayTransportNegotiationCancelledError('WebRTC negotiation was superseded.');
    }

    const generationId = parsed.data.generationId;
    const peer = this.options.peerFactory({ generationId, udpPortRange: this.options.udpPortRange });
    record.generationId = generationId;
    record.peer = peer;
    record.mode = this.fallbackMode(record.session);
    record.fallbackTriggered = false;
    record.heartbeatNonce = 0;
    record.pendingHeartbeatNonce = null;
    record.missedHeartbeats = 0;
    record.rttSamples = [];
    try {
      this.bindPeer(record, peer, generationId);
      record.activationExpiresAt = this.now() + ACTIVATION_TIMEOUT_MS;
      record.activationTimer = setTimeout(() => {
        if (!this.isCurrentPeer(record, peer, generationId) || record.mode === 'webrtc') return;
        void this.transitionToFallback(record, generationId, peer);
      }, ACTIVATION_TIMEOUT_MS);
      const answer = await peer.negotiate(parsed.data.offer);
      if (
        !this.isCurrentPeer(record, peer, generationId)
        || record.negotiationSequence !== sequence
      ) {
        await this.closePeer(peer);
        throw new GameplayTransportNegotiationCancelledError('WebRTC negotiation was superseded.');
      }
      return { generationId, answer };
    } catch (error) {
      const stillCurrent = this.isCurrentPeer(record, peer, generationId)
        && record.negotiationSequence === sequence;
      if (stillCurrent) {
        await this.transitionToFallback(record, generationId, peer);
      }
      if (!stillCurrent && !(error instanceof GameplayTransportNegotiationCancelledError)) {
        throw new GameplayTransportNegotiationCancelledError('WebRTC negotiation was cancelled with its stale session.');
      }
      throw error;
    }
  }

  activate(socketId: string, request: RtcActivationRequest): boolean {
    const record = this.sessionsBySocket.get(socketId);
    const parsed = rtcActivationRequestSchema.safeParse(request);
    if (!record || record.disposed || !parsed.success) return false;
    const { peer, generationId, activationExpiresAt } = record;
    if (
      peer
      && generationId === parsed.data.generationId
      && record.mode === 'webrtc'
      && !record.fallbackTriggered
    ) return true;
    if (
      !peer
      || generationId !== parsed.data.generationId
      || record.mode === 'webrtc'
      || record.fallbackTriggered
      || activationExpiresAt === null
      || this.now() >= activationExpiresAt
    ) {
      if (peer && generationId === parsed.data.generationId && this.now() >= (activationExpiresAt ?? 0)) {
        void this.transitionToFallback(record, generationId, peer);
      }
      return false;
    }

    try {
      if (!peer.isReady()) return false;
    } catch {
      void this.transitionToFallback(record, generationId, peer);
      return false;
    }

    if (record.activationTimer) clearTimeout(record.activationTimer);
    record.activationTimer = null;
    record.activationExpiresAt = null;
    record.mode = 'webrtc';
    safeInvoke(() => record.session.setNetworkMode('webrtc'));
    safeInvoke(() => record.session.emitMode({ generationId, mode: 'webrtc' }));
    this.startHeartbeat(record, peer, generationId);
    this.startRttSampling(record, peer, generationId);
    return true;
  }

  fallback(socketId: string): void {
    const record = this.sessionsBySocket.get(socketId);
    if (!record || record.disposed || !record.peer) return;
    void this.transitionToFallback(record, record.generationId, record.peer);
  }

  publish(publication: TransportPublication): void {
    for (const record of [...this.sessionsBySocket.values()]) {
      if (record.disposed || record.session.roomCode !== publication.roomCode) continue;
      try {
        this.publishToSession(record, publication);
      } catch {
        if (record.peer) void this.transitionToFallback(record, record.generationId, record.peer);
      }
    }
  }

  synchronizeSession(socketId: string, publication: MatchStartedPublication): void {
    const record = this.sessionsBySocket.get(socketId);
    if (!record || record.disposed) return;
    this.publishToSession(record, {
      type: 'MATCH_STARTED',
      roomCode: record.session.roomCode,
      ...publication
    });
  }

  async detachSession(socketId: string): Promise<void> {
    const record = this.sessionsBySocket.get(socketId);
    if (!record) return;
    this.sessionsBySocket.delete(socketId);
    if (this.sessionsByPlayer.get(record.session.playerId) === record) {
      this.sessionsByPlayer.delete(record.session.playerId);
    }
    await this.disposeRecord(record);
  }

  modeForPlayer(playerId: string): GameplayTransportMode | null {
    return this.sessionsByPlayer.get(playerId)?.mode ?? null;
  }

  generationForPlayerForTest(playerId: string): Readonly<{
    generationId: string | null;
    negotiationCount: number;
  }> | null {
    const record = this.sessionsByPlayer.get(playerId);
    return record
      ? { generationId: record.generationId, negotiationCount: record.negotiationSequence }
      : null;
  }

  async dropPeerForTest(playerId: string): Promise<void> {
    const record = this.sessionsByPlayer.get(playerId);
    if (!record?.peer || record.disposed) return;
    await this.transitionToFallback(record, record.generationId, record.peer);
  }

  async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      const records = [...this.sessionsBySocket.values()];
      this.sessionsBySocket.clear();
      this.sessionsByPlayer.clear();
      await Promise.all(records.map((record) => this.disposeRecord(record)));
    }
    await Promise.all([...this.pendingPeerClosures]);
  }

  private requireSession(socketId: string): SessionRecord {
    const record = this.sessionsBySocket.get(socketId);
    if (!record || record.disposed || this.stopped) {
      throw new GameplayTransportNegotiationCancelledError('Gameplay transport session is not attached.');
    }
    return record;
  }

  private fallbackMode(session: TransportSession): SocketGameplayTransportMode {
    try {
      return session.socketMode() === 'polling' ? 'polling' : 'websocket';
    } catch {
      return 'websocket';
    }
  }

  private bindPeer(record: SessionRecord, peer: ServerPeer, generationId: string): void {
    record.unsubscribers.push(
      peer.onFastMessage((serialized) => this.acceptFastMessage(record, peer, generationId, serialized))
    );
    record.unsubscribers.push(
      peer.onReliableMessage((serialized) => this.acceptReliableMessage(record, peer, generationId, serialized))
    );
    record.unsubscribers.push(peer.onClosed(() => {
      if (this.isCurrentPeer(record, peer, generationId)) {
        void this.transitionToFallback(record, generationId, peer);
      }
    }));
  }

  private acceptFastMessage(
    record: SessionRecord,
    peer: ServerPeer,
    generationId: string,
    serialized: string
  ): void {
    if (!this.isCurrentPeer(record, peer, generationId) || record.mode !== 'webrtc') return;
    const parsed = clientFastMessageSchema.safeParse(serialized);
    if (
      !parsed.success
      || parsed.data.generationId !== generationId
      || record.matchEpoch === null
      || parsed.data.matchEpoch !== record.matchEpoch
    ) return;

    const result = record.session.inputIngress.accept(parsed.data.payload, 'webrtc');
    if (result.status === 'error') safeInvoke(() => record.session.emitError(result.error));
  }

  private acceptReliableMessage(
    record: SessionRecord,
    peer: ServerPeer,
    generationId: string,
    serialized: string
  ): void {
    if (!this.isCurrentPeer(record, peer, generationId) || record.mode !== 'webrtc') return;
    const parsed = clientReliableMessageSchema.safeParse(serialized);
    if (
      !parsed.success
      || parsed.data.generationId !== generationId
      || parsed.data.nonce !== record.pendingHeartbeatNonce
    ) return;
    record.pendingHeartbeatNonce = null;
    record.missedHeartbeats = 0;
  }

  private publishToSession(record: SessionRecord, publication: TransportPublication): void {
    if (publication.type === 'MATCH_STARTED') {
      record.matchEpoch = publication.matchEpoch;
      const payload: MatchStartedPublication = {
        matchEpoch: publication.matchEpoch,
        eventCursor: publication.eventCursor,
        snapshot: publication.snapshot
      };
      safeInvoke(() => record.session.emitStarted(payload));
      if (record.mode !== 'webrtc' || !record.peer || !record.generationId) return;
      const message: ServerReliableMessage = {
        version: GAMEPLAY_PROTOCOL_VERSION,
        generationId: record.generationId,
        kind: 'started',
        payload
      };
      this.sendReliable(record, message);
      return;
    }

    if (publication.type === 'MATCH_EVENT') {
      const payload: MatchEventPublication = {
        matchEpoch: publication.matchEpoch,
        event: publication.event
      };
      safeInvoke(() => record.session.emitEvent(payload));
      if (record.mode !== 'webrtc' || !record.peer || !record.generationId) return;
      const message: ServerReliableMessage = {
        version: GAMEPLAY_PROTOCOL_VERSION,
        generationId: record.generationId,
        kind: 'event',
        payload
      };
      this.sendReliable(record, message);
      return;
    }

    if (record.mode !== 'webrtc' || !record.peer || !record.generationId) {
      safeInvoke(() => record.session.emitSnapshot({
        matchEpoch: publication.matchEpoch,
        eventCursor: publication.eventCursor,
        snapshot: publication.snapshot
      }));
      return;
    }

    const peer = record.peer;
    const message: ServerFastMessage = {
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: record.generationId,
      kind: 'snapshot',
      payload: {
        matchEpoch: publication.matchEpoch,
        eventCursor: publication.eventCursor,
        snapshot: publication.snapshot
      }
    };
    let result: ReturnType<ServerPeer['sendFast']>;
    try {
      result = peer.sendFast(JSON.stringify(message));
    } catch {
      result = 'closed';
    }
    if (result === 'sent' || result === 'backpressured') return;
    void this.transitionToFallback(record, record.generationId, peer);
    safeInvoke(() => record.session.emitSnapshot({
      matchEpoch: publication.matchEpoch,
      eventCursor: publication.eventCursor,
      snapshot: publication.snapshot
    }));
  }

  private sendReliable(record: SessionRecord, message: ServerReliableMessage): void {
    const peer = record.peer;
    if (!peer) return;
    let result: ReturnType<ServerPeer['sendReliable']>;
    try {
      result = peer.sendReliable(JSON.stringify(message));
    } catch {
      result = 'closed';
    }
    if (result !== 'sent') void this.transitionToFallback(record, record.generationId, peer);
  }

  private startHeartbeat(record: SessionRecord, peer: ServerPeer, generationId: string): void {
    record.heartbeatTimer = setInterval(() => {
      if (!this.isCurrentPeer(record, peer, generationId) || record.mode !== 'webrtc') return;
      if (record.pendingHeartbeatNonce !== null) {
        record.missedHeartbeats += 1;
        if (record.missedHeartbeats >= MISSED_HEARTBEATS_BEFORE_FALLBACK) {
          void this.transitionToFallback(record, generationId, peer);
          return;
        }
      }

      const nonce = ++record.heartbeatNonce;
      const message: ServerReliableMessage = {
        version: GAMEPLAY_PROTOCOL_VERSION,
        generationId,
        kind: 'heartbeat',
        nonce
      };
      let result: ReturnType<ServerPeer['sendReliable']>;
      try {
        result = peer.sendReliable(JSON.stringify(message));
      } catch {
        result = 'closed';
      }
      if (result !== 'sent') {
        void this.transitionToFallback(record, generationId, peer);
        return;
      }
      record.pendingHeartbeatNonce = nonce;
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startRttSampling(record: SessionRecord, peer: ServerPeer, generationId: string): void {
    record.rttTimer = setInterval(() => {
      void this.sampleRtt(record, peer, generationId);
    }, RTT_SAMPLE_INTERVAL_MS);
  }

  private async sampleRtt(record: SessionRecord, peer: ServerPeer, generationId: string): Promise<void> {
    if (
      record.rttSampling !== null
      || !this.isCurrentPeer(record, peer, generationId)
      || record.mode !== 'webrtc'
    ) return;
    const owner: RttSamplingOwner = { peer, generationId };
    record.rttSampling = owner;
    let rttMs: number | null;
    try {
      rttMs = await peer.sampleRttMs();
    } catch {
      if (record.rttSampling === owner) record.rttSampling = null;
      if (this.isCurrentPeer(record, peer, generationId)) {
        void this.transitionToFallback(record, generationId, peer);
      }
      return;
    }
    if (record.rttSampling === owner) record.rttSampling = null;
    if (
      !this.isCurrentPeer(record, peer, generationId)
      || record.mode !== 'webrtc'
      || rttMs === null
      || !Number.isFinite(rttMs)
      || rttMs < 0
    ) return;

    const sampledAt = this.now();
    record.rttSamples.push({ value: Math.round(rttMs), sampledAt });
    if (record.rttSamples.length > RTT_SAMPLE_LIMIT) {
      record.rttSamples.splice(0, record.rttSamples.length - RTT_SAMPLE_LIMIT);
    }
    record.rttFresh = true;
    safeInvoke(() => record.session.setNetworkSample(
      median(record.rttSamples.map((sample) => sample.value)),
      sampledAt
    ));
    if (record.rttFreshnessTimer) clearTimeout(record.rttFreshnessTimer);
    record.rttFreshnessTimer = setTimeout(() => {
      if (
        !record.rttFresh
        || !this.isCurrentPeer(record, peer, generationId)
        || record.mode !== 'webrtc'
      ) return;
      const latest = record.rttSamples.at(-1);
      if (!latest || this.now() - latest.sampledAt < RTT_FRESHNESS_MS) return;
      record.rttFresh = false;
      safeInvoke(() => record.session.clearNetworkSample());
    }, RTT_FRESHNESS_MS);
  }

  private async transitionToFallback(
    record: SessionRecord,
    generationId: string | null,
    peer: ServerPeer
  ): Promise<void> {
    if (
      record.disposed
      || record.generationId !== generationId
      || (record.peer !== peer && !record.fallbackTriggered)
    ) return;
    if (record.fallbackTriggered) return this.closePeer(peer);

    record.fallbackTriggered = true;
    const mode = this.fallbackMode(record.session);
    record.mode = mode;
    const closure = this.disposePeer(record, peer);
    safeInvoke(() => record.session.setNetworkMode(mode));
    safeInvoke(() => record.session.emitMode({ generationId, mode }));
    safeInvoke(() => record.session.clearNetworkSample());
    safeInvoke(() => record.session.probeFallbackPing());
    await closure;
  }

  private disposePeer(record: SessionRecord, peer: ServerPeer): Promise<void> {
    if (record.peer === peer) record.peer = null;
    this.clearPeerTimers(record);
    for (const unsubscribe of record.unsubscribers.splice(0)) safeInvoke(unsubscribe);
    record.activationExpiresAt = null;
    record.pendingHeartbeatNonce = null;
    record.missedHeartbeats = 0;
    if (record.rttSampling?.peer === peer) record.rttSampling = null;
    record.rttFresh = false;
    record.rttSamples = [];
    return this.closePeer(peer);
  }

  private closePeer(peer: ServerPeer): Promise<void> {
    const existing = this.peerClosures.get(peer);
    if (existing) return existing;
    const closure = Promise.resolve()
      .then(() => peer.close())
      .catch(() => undefined);
    this.peerClosures.set(peer, closure);
    this.pendingPeerClosures.add(closure);
    void closure.then(() => this.pendingPeerClosures.delete(closure));
    return closure;
  }

  private clearPeerTimers(record: SessionRecord): void {
    if (record.activationTimer) clearTimeout(record.activationTimer);
    if (record.heartbeatTimer) clearInterval(record.heartbeatTimer);
    if (record.rttTimer) clearInterval(record.rttTimer);
    if (record.rttFreshnessTimer) clearTimeout(record.rttFreshnessTimer);
    record.activationTimer = null;
    record.heartbeatTimer = null;
    record.rttTimer = null;
    record.rttFreshnessTimer = null;
  }

  private removeRecord(record: SessionRecord): void {
    this.sessionsBySocket.delete(record.session.socketId);
    if (this.sessionsByPlayer.get(record.session.playerId) === record) {
      this.sessionsByPlayer.delete(record.session.playerId);
    }
    void this.disposeRecord(record);
  }

  private async disposeRecord(record: SessionRecord): Promise<void> {
    if (record.disposed) return;
    record.disposed = true;
    record.negotiationSequence += 1;
    const peer = record.peer;
    this.clearPeerTimers(record);
    for (const unsubscribe of record.unsubscribers.splice(0)) safeInvoke(unsubscribe);
    record.peer = null;
    record.pendingHeartbeatNonce = null;
    record.rttSamples = [];
    record.rttSampling = null;
    if (record.mode === 'webrtc' || record.rttFresh) {
      safeInvoke(() => record.session.clearNetworkSample());
    }
    record.rttFresh = false;
    if (peer) await this.closePeer(peer);
  }

  private isCurrentRecord(record: SessionRecord): boolean {
    return !record.disposed && this.sessionsBySocket.get(record.session.socketId) === record;
  }

  private isCurrentPeer(record: SessionRecord, peer: ServerPeer, generationId: string): boolean {
    return this.isCurrentRecord(record)
      && record.peer === peer
      && record.generationId === generationId;
  }
}
