# WebRTC Gameplay Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move latency-sensitive active-match traffic between each browser and the authoritative Node.js server to WebRTC DataChannels while keeping Socket.IO for room control, signaling, critical safety copies, and automatic fallback.

**Architecture:** Every authenticated Socket.IO player session may negotiate one browser-to-Node Werift peer. An unordered, zero-retransmit channel carries input and snapshots; an ordered reliable channel carries start/events and health messages. One server-owned transport hub selects the per-player route, while a shared input ingress and a client publication sequencer prevent transport-specific rule drift, duplicates, and out-of-order effects.

**Tech Stack:** Node.js 20+, TypeScript 6, React 19, Socket.IO 4.8, Zod 4, `werift@0.24.4`, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md`

## Global Constraints

- WebRTC connects each browser to the authoritative Node.js process, never to the room owner's browser.
- Socket.IO remains the control plane and automatic compatibility fallback.
- Use exactly `werift@0.24.4`; do not add a native `wrtc` binding, C++, or WebAssembly.
- Use non-trickle ICE, host candidates only, and default UDP ports `53100–53131`.
- Read optional overrides only from `GAME_WEBRTC_UDP_PORT_MIN` and `GAME_WEBRTC_UDP_PORT_MAX`.
- `match-fast` is unordered with `maxRetransmits: 0`; `match-reliable` is ordered and reliable.
- Client-to-server DataChannel messages are limited to 8 KiB; SDP is limited to 128 KiB.
- A fast channel with more than 256 KiB buffered drops intermediate snapshots instead of growing an unbounded queue; a client whose input cannot be queued sends that input once through Socket.IO.
- Browser candidate gathering is limited to three seconds; negotiation plus activation is limited to five seconds.
- Heartbeats run every one second; three missed heartbeats trigger fallback.
- WebRTC RTT is sampled every two seconds, keeps five samples, and expires after six seconds.
- Match input always passes through one validator, limiter, and monotonic sequence gate, regardless of transport.
- Every `GameEvent` is published to consumers in `eventId` order within its `matchEpoch`.
- The UI shows one field named `Ping`; it does not restore RTT, Delay, Rollback, or RB columns.
- WebRTC failure must not eject, penalize, or block a player from the match.
- Do not carry the uncommitted browser-to-browser RTT prototype from the original working tree into the implementation worktree.
- Keep simulation and combat code independent of network transport.

---

## Purpose / Big Picture

After this work, a player opening the LAN game in a supported browser negotiates a direct WebRTC DataChannel connection to the Node.js game server. Input and authoritative snapshots normally travel on a low-latency partially reliable path, while hit, knockout, ring-out, phase, and result events arrive first over a reliable DataChannel and also have a Socket.IO safety copy. If UDP or WebRTC is unavailable, the same player remains in the same match and uses the existing Socket.IO route automatically.

The change is visible in three ways. The player list shows one honest Ping value from the active transport. A test-only server surface reports whether each player is on `webrtc`, `websocket`, or `polling`. A real two-browser acceptance test proves that input reaches the authoritative simulation over WebRTC and still reaches it after a forced DataChannel failure.

## Progress

- [x] (2026-09-01 13:23Z) Approved and committed the architecture spec at commit `d953982`.
- [ ] Create a clean execution worktree from the feature branch; exclude the abandoned uncommitted browser-to-browser prototype.
- [ ] Complete Task 1: shared protocol, dependency, and wire contracts.
- [ ] Complete Task 2: shared server input ingress.
- [ ] Complete Task 3: ordered client publication sequencer.
- [ ] Complete Task 4: real Werift peer adapter.
- [ ] Complete Task 5: server gameplay transport hub and Ping sampler.
- [ ] Complete Task 6: browser gameplay transport and GameClient arbitration.
- [ ] Complete Task 7: authoritative publication routing, lifecycle, and network state integration.
- [ ] Complete Task 8: HUD, real-browser fallback, load, documentation, and full verification.
- [ ] Publish the completed branch, merge it to public `main`, restart the LAN server from the verified build, and record reachability separately from another-device acceptance.

## Surprises & Discoveries

- Observation: the original working tree contains an uncommitted browser-to-browser WebRTC RTT prototype created before the accepted architecture was finalized.
  Evidence: it introduces `src/client/network/RtcTelemetry.ts` and relays `network:rtc-signal` between room players, while `GameClient.sendInput()` and server publication dispatch remain Socket.IO-only. It is not part of commit `d953982` and must not become the implementation base.
- Observation: a real Chromium-to-Node feasibility probe successfully opened a DataChannel against `werift@0.24.4` and exposed a selected candidate-pair RTT.
  Evidence: the local probe reached `connectionState: connected` and returned a non-null `currentRoundTripTime`; this proves API viability, not representative LAN latency.
- Observation: Werift 0.24.4 exposes the exact primitives required without a native addon.
  Evidence: `RTCPeerConnection({ icePortRange })`, `onDataChannel`, `connectionStateChange`, `setRemoteDescription`, `createAnswer`, `setLocalDescription`, `getStats`, `RTCDataChannel.onMessage`, and `close` are present in the published type declarations.
- Observation: dual delivery alone does not preserve event order across two transports.
  Evidence: current consumers suppress duplicate IDs but publish events immediately; this plan therefore adds a single `matchEpoch`-aware reorder buffer before `GameClient` listeners.

## Decision Log

- Decision: keep Socket.IO for room/session control, WebRTC negotiation, critical safety copies, and fallback.
  Rationale: deleting Socket.IO would require another signaling/control protocol and would reduce compatibility without improving low-frequency room actions.
  Date/Author: 2026-09-01, user and Jarvis.
- Decision: use browser-to-authoritative-Node WebRTC rather than browser-to-room-host WebRTC.
  Rationale: Node owns simulation authority and remains the real latency target even when `hostPlayerId` migrates.
  Date/Author: 2026-09-01, user and Jarvis.
- Decision: use one fast channel and one reliable channel.
  Rationale: stale input/snapshots should not block newer state, while game events need reliable ordered first delivery.
  Date/Author: 2026-09-01, Jarvis.
- Decision: duplicate start/events over Socket.IO and reorder them at the client.
  Rationale: low-frequency safety copies prevent an abrupt channel loss from dropping a critical effect; the reorder buffer eliminates cross-transport inversion.
  Date/Author: 2026-09-01, Jarvis after spec review.
- Decision: use a clean worktree based on the committed spec rather than modifying the abandoned prototype in place.
  Rationale: this preserves the running server and prevents a browser-to-browser topology from leaking into the Node-authoritative design.
  Date/Author: 2026-09-01, Jarvis.

## Outcomes & Retrospective

Implementation has not started. Update this section after every major task with the observable behavior achieved, remaining gaps, and measured Socket.IO-versus-WebRTC latency. At completion, explicitly state whether another physical LAN device was tested; local Playwright success is not a substitute for that acceptance.

## Context and Orientation

`src/server/rooms/roomManager.ts` owns rooms, players, simulation input, match advancement, and `RoomPublication` values. `src/server/network/createGameServer.ts` currently converts every publication into a room-wide Socket.IO emit. `src/server/network/socketHandlers.ts` currently validates `match:input`, applies two input rate limits, rejects non-monotonic `seq` values, and invokes `RoomManager.applyInput()`.

On the browser, `src/client/network/GameClient.ts` owns Socket.IO and exposes a transport-neutral `GameClient` interface to `src/client/state/gameStore.ts`. `GameClient.sendInput()` currently emits `match:input` through Socket.IO. Match snapshots and events are republished immediately to store listeners. The Phaser presentation already reconciles snapshots through `lastProcessedInputSeq`, and every game event already has a monotonically increasing `eventId` starting at 1 for each match.

A `matchEpoch` in this plan is a room-owned integer incremented whenever `RoomManager.startMatch()` creates a new match. It disambiguates rematches without changing combat state. A WebRTC `generationId` is a UUID for one peer negotiation and disambiguates late packets from a closed or replaced peer. They are separate values.

The server-side `GameplayTransportHub` is a network adapter, not a game service. It owns peers, heartbeats, RTT sampling, per-player mode, and routing. It receives already formed room publications and calls the same input ingress as Socket.IO. `RoomManager` remains unaware of peer connections, SDP, DataChannels, and Werift.

The browser-side `GameplayTransport` owns `RTCPeerConnection`, both DataChannels, offer creation, activation, health, fallback, and JSON wire parsing. `GameClient` owns arbitration: it sends input through `GameplayTransport` only when the server-confirmed mode is WebRTC, otherwise through Socket.IO.

## File Structure

Create these focused files:

- `src/shared/gameplayTransport.ts`: constants, publication envelopes, negotiation schemas, DataChannel schemas, and shared types.
- `src/shared/gameplayTransport.test.ts`: schema, size limit, and envelope contract tests.
- `src/server/network/matchInputIngress.ts`: the single per-session validation/rate/sequence/domain-error input path.
- `src/server/network/matchInputIngress.test.ts`: deterministic duplicate, invalid, result, and rate-limit tests.
- `src/server/network/gameplayTransport/ServerPeer.ts`: dependency-free peer and factory interfaces used by the hub.
- `src/server/network/gameplayTransport/WeriftServerPeer.ts`: the only module importing Werift.
- `src/server/network/gameplayTransport/WeriftServerPeer.test.ts`: real Node peer lifecycle and stats tests.
- `src/server/network/gameplayTransport/GameplayTransportHub.ts`: session binding, negotiation, activation, routing, heartbeat, fallback, Ping, and cleanup.
- `src/server/network/gameplayTransport/GameplayTransportHub.test.ts`: fake-peer state-machine and routing tests.
- `src/client/network/MatchPublicationSequencer.ts`: per-match start/snapshot/event ordering and duplicate suppression.
- `src/client/network/MatchPublicationSequencer.test.ts`: cross-transport reorder, gap, overflow, and rematch tests.
- `src/client/network/GameplayTransport.ts`: browser peer lifecycle, channels, offer/answer, arbitration, and fallback.
- `src/client/network/GameplayTransport.test.ts`: injected-browser-peer tests without a real browser.
- `tests/e2e/webrtcGameplay.spec.ts`: real Chromium-to-Werift activation, input, Ping, failure, and rematch acceptance.

Modify these existing files:

- `package.json`, `package-lock.json`: exact Werift dependency and verification scripts only if a dedicated real-WebRTC test command is needed.
- `src/shared/protocol.ts`, `src/shared/protocol.test.ts`: Socket.IO negotiation, activation, fallback, mode, and epoch-bearing match publication contracts.
- `src/shared/model.ts`: add `webrtc` to `PlayerNetworkTransport`; keep one network status shape.
- `src/server/network/socketHandlers.ts`: delegate input to `MatchInputIngress`, expose negotiation/activation/fallback, and trigger immediate Socket.IO Ping on fallback.
- `src/server/network/createGameServer.ts`, `src/server/network/createGameServer.test.ts`: instantiate the hub, route publications, bind sessions, expose test-only transport controls, and stop every peer.
- `src/server/rooms/roomManager.ts`, `src/server/rooms/roomManager.test.ts`: own `matchEpoch`, timestamp Ping samples, clear samples on mode changes, and publish epoch/cursor metadata.
- `src/client/network/GameClient.ts`, `src/client/network/GameClient.test.ts`: integrate `GameplayTransport` and `MatchPublicationSequencer` while preserving the public `GameClient` API.
- `src/client/ui/MatchHud.tsx`, `src/client/ui/MatchHud.test.tsx`: render exactly one Ping value for every row.
- `tests/integration/socketFlow.test.ts`: prove pure Socket.IO fallback remains complete and duplicate input is accepted once.
- `tests/integration/serverLifecycle.test.ts`: prove peers close and UDP ports can be reused after stop/restart.
- `tests/load/eightClients.test.ts`: preserve the eight-client fallback load gate.
- `tests/e2e/networkFallback.spec.ts`, `tests/e2e/mobile.spec.ts`, `tests/e2e/performance.spec.ts`: add WebRTC-disabled, mobile smoke, and frame/latency measurements without weakening existing gates.
- `tests/e2e/fixtures.ts`: expose test-only transport mode and forced peer drop helpers.
- `README.md`: document UDP ports, firewall rules, fallback semantics, and honest Ping meaning.

## Interfaces and Dependencies

Task 1 must define the shared contracts with these stable names:

    export const GAMEPLAY_PROTOCOL_VERSION = 1 as const;
    export const FAST_CHANNEL_LABEL = 'match-fast';
    export const RELIABLE_CHANNEL_LABEL = 'match-reliable';
    export const CLIENT_MESSAGE_LIMIT_BYTES = 8 * 1024;
    export const SDP_LIMIT_BYTES = 128 * 1024;
    export const FAST_CHANNEL_MAX_BUFFERED_BYTES = 256 * 1024;
    export const ICE_GATHER_TIMEOUT_MS = 3_000;
    export const ACTIVATION_TIMEOUT_MS = 5_000;
    export const HEARTBEAT_INTERVAL_MS = 1_000;
    export const MISSED_HEARTBEATS_BEFORE_FALLBACK = 3;
    export const RTT_SAMPLE_INTERVAL_MS = 2_000;
    export const RTT_FRESHNESS_MS = 6_000;
    export const RTT_SAMPLE_LIMIT = 5;

    export type PlayerNetworkTransport = 'webrtc' | 'websocket' | 'polling';
    export type GameplayTransportMode = PlayerNetworkTransport;
    export type MatchStartedPublication = Readonly<{
      matchEpoch: number;
      eventCursor: number;
      snapshot: MatchSnapshot;
    }>;
    export type MatchSnapshotPublication = MatchStartedPublication;
    export type MatchEventPublication = Readonly<{
      matchEpoch: number;
      event: GameEvent;
    }>;

    export type RtcOffer = Readonly<{ type: 'offer'; sdp: string }>;
    export type RtcAnswer = Readonly<{ type: 'answer'; sdp: string }>;
    export type RtcNegotiationRequest = Readonly<{
      generationId: string;
      offer: RtcOffer;
    }>;
    export type RtcNegotiationAnswer = Readonly<{
      generationId: string;
      answer: RtcAnswer;
    }>;
    export type RtcActivationRequest = Readonly<{ generationId: string }>;
    export type TransportModeNotice = Readonly<{
      generationId: string | null;
      mode: GameplayTransportMode;
    }>;

The fast channel carries one client message and one server message:

    export type ClientFastMessage = Readonly<{
      version: 1;
      generationId: string;
      matchEpoch: number;
      kind: 'input';
      payload: InputFrame;
    }>;

    export type ServerFastMessage = Readonly<{
      version: 1;
      generationId: string;
      kind: 'snapshot';
      payload: MatchSnapshotPublication;
    }>;

The reliable channel carries starts, events, and heartbeat acknowledgements:

    export type ClientReliableMessage = Readonly<{
      version: 1;
      generationId: string;
      kind: 'heartbeat-ack';
      nonce: number;
    }>;

    export type ServerReliableMessage =
      | Readonly<{ version: 1; generationId: string; kind: 'started'; payload: MatchStartedPublication }>
      | Readonly<{ version: 1; generationId: string; kind: 'event'; payload: MatchEventPublication }>
      | Readonly<{ version: 1; generationId: string; kind: 'heartbeat'; nonce: number }>;

Task 2 must expose:

    export type MatchInputIngressResult =
      | Readonly<{ status: 'accepted' | 'dropped' }>
      | Readonly<{ status: 'error'; error: ServerError }>;

    export interface MatchInputIngress {
      accept(payload: unknown): MatchInputIngressResult;
      reset(): void;
    }

    export function createMatchInputIngress(options: Readonly<{
      connectionId: string;
      rooms: RoomManager;
      now: () => number;
      logger: Pick<Console, 'error'>;
    }>): MatchInputIngress;

Task 4 must hide Werift behind:

    export type PeerSendResult = 'sent' | 'backpressured' | 'closed';

    export interface ServerPeer {
      readonly generationId: string;
      negotiate(offer: RtcOffer): Promise<RtcAnswer>;
      isReady(): boolean;
      sendFast(serialized: string): PeerSendResult;
      sendReliable(serialized: string): PeerSendResult;
      sampleRttMs(): Promise<number | null>;
      onFastMessage(listener: (serialized: string) => void): () => void;
      onReliableMessage(listener: (serialized: string) => void): () => void;
      onClosed(listener: () => void): () => void;
      close(): Promise<void>;
    }

    export type ServerPeerFactory = (options: Readonly<{
      generationId: string;
      udpPortRange: readonly [number, number];
    }>) => ServerPeer;

Task 5 must expose a hub whose public surface is transport-focused:

    export interface GameplayTransportHub {
      attachSession(session: TransportSession): void;
      negotiate(socketId: string, request: RtcNegotiationRequest): Promise<RtcNegotiationAnswer>;
      activate(socketId: string, request: RtcActivationRequest): boolean;
      fallback(socketId: string): void;
      publish(publication: TransportPublication): void;
      detachSession(socketId: string): Promise<void>;
      modeForPlayer(playerId: string): GameplayTransportMode | null;
      dropPeerForTest(playerId: string): Promise<void>;
      stop(): Promise<void>;
    }

`TransportSession` contains `socketId`, `playerId`, `roomCode`, the shared `MatchInputIngress`, a typed Socket.IO emitter, an immediate fallback-Ping callback, and network-state callbacks. `TransportPublication` is the epoch-bearing started/snapshot/event union; it never contains a peer target supplied by a browser.

## Plan of Work

Build the transport in layers that leave the game playable at every commit. First lock shared contracts and extract input/event-order boundaries while all traffic remains Socket.IO. Next prove the real Node peer independently. Then build the server hub and browser controller against injected fakes. Only after both sides pass unit tests should `createGameServer` route real match traffic through the hub. Finish with UI, real browsers, failure injection, load, documentation, and the full verification gate.

### Task 1: Lock the Shared Wire Contract and Werift Dependency

**Files:**
- Create: `src/shared/gameplayTransport.ts`
- Create: `src/shared/gameplayTransport.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/protocol.test.ts`
- Modify: `src/shared/model.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing `Ack`, `InputFrame`, `MatchSnapshot`, `GameEvent`, and `matchInputSchema` semantics.
- Produces: every constant and type listed in `Interfaces and Dependencies`, plus Zod schemas named `rtcNegotiationRequestSchema`, `rtcActivationRequestSchema`, `clientFastMessageSchema`, and `clientReliableMessageSchema`.

- [ ] **Step 1: Write failing shared contract tests.**

  Add tests that accept an offer at exactly 128 KiB, reject one byte above it, reject a non-UUID generation, reject a client message above 8 KiB before JSON parsing, accept only `version: 1`, accept only `match-fast` input and reliable heartbeat acknowledgements, and add `webrtc` to `PlayerNetworkTransport`.

      it('rejects an oversized SDP offer', () => {
        const parsed = rtcNegotiationRequestSchema.safeParse({
          generationId: '2f8ca1f2-7e6e-4ea7-90e2-e6a955892574',
          offer: { type: 'offer', sdp: 'x'.repeat(SDP_LIMIT_BYTES + 1) }
        });
        expect(parsed.success).toBe(false);
      });

      it('keeps WebRTC signaling bound to the current socket instead of a target player', () => {
        expect(rtcNegotiationRequestSchema.safeParse({
          generationId: '2f8ca1f2-7e6e-4ea7-90e2-e6a955892574',
          targetPlayerId: 'other-player',
          offer: { type: 'offer', sdp: 'v=0' }
        }).success).toBe(false);
      });

- [ ] **Step 2: Run the focused tests and confirm RED.**

      npx vitest run src/shared/gameplayTransport.test.ts src/shared/protocol.test.ts --maxWorkers=1

  Expected: failure because `gameplayTransport.ts` and the new schemas/events do not exist.

- [ ] **Step 3: Add the exact dependency.**

      npm install --save-exact werift@0.24.4

  Confirm `package.json` contains `"werift": "0.24.4"` and the lockfile records the same resolved version.

- [ ] **Step 4: Implement the shared contracts.**

  Move the reusable `matchInputSchema` to `src/shared/gameplayTransport.ts` and re-export it from `src/shared/protocol.ts` so existing imports remain coherent. Use `.strict()`, `z.string().uuid()`, finite non-negative integers for epochs/nonces, and `new TextEncoder().encode(value).byteLength` for both the SDP refinement and the pre-`JSON.parse` DataChannel limit. Do not use `z.string().max()` for byte limits because non-ASCII code points are not one byte.

  Extend Socket.IO types with these exact events:

      'transport:negotiate': (
        payload: RtcNegotiationRequest,
        acknowledge: (ack: Ack<RtcNegotiationAnswer>) => void
      ) => void;
      'transport:activate': (
        payload: RtcActivationRequest,
        acknowledge: (ack: Ack<TransportModeNotice>) => void
      ) => void;
      'transport:fallback': (payload: Readonly<Record<string, never>>) => void;

      'transport:mode': (notice: TransportModeNotice) => void;
      'match:started': (publication: MatchStartedPublication) => void;
      'match:snapshot': (publication: MatchSnapshotPublication) => void;
      'match:event': (publication: MatchEventPublication) => void;

- [ ] **Step 5: Run focused tests, typecheck, and dependency audit.**

      npx vitest run src/shared/gameplayTransport.test.ts src/shared/protocol.test.ts --maxWorkers=1
      npm run typecheck
      npm ls werift

  Expected: focused tests pass, typecheck passes, and npm reports exactly `werift@0.24.4`.

- [ ] **Step 6: Commit Task 1.**

      git add package.json package-lock.json src/shared/model.ts src/shared/protocol.ts src/shared/protocol.test.ts src/shared/gameplayTransport.ts src/shared/gameplayTransport.test.ts
      git commit -m "feat: define WebRTC gameplay transport contract"

### Task 2: Extract One Authoritative Match Input Ingress

**Files:**
- Create: `src/server/network/matchInputIngress.ts`
- Create: `src/server/network/matchInputIngress.test.ts`
- Modify: `src/server/network/socketHandlers.ts`
- Modify: `src/server/network/createGameServer.test.ts`
- Test: `tests/integration/socketFlow.test.ts`

**Interfaces:**
- Consumes: `matchInputSchema`, `RoomManager.applyInput()`, `RoomManager.isInResult()`, `GAME.inputRateLimitPerSecond`, and `GAME.maxInputFramesPerSecond`.
- Produces: `createMatchInputIngress()` and one per-Socket.IO-session ingress object that both Socket.IO and Task 5's WebRTC hub will call.

- [ ] **Step 1: Write failing ingress tests.**

  Use a real `RoomManager` with deterministic time. Start a two-player match, then prove: invalid payload returns `INVALID_PAYLOAD`; the same `seq` submitted twice advances once; a lower sequence drops; post-result input drops without an error; exceeding either input bucket drops; and a domain failure becomes a safe `ServerError`.

      const ingress = createMatchInputIngress({
        connectionId: 'host-socket', rooms, now: () => nowMs, logger
      });
      expect(ingress.accept(input({ seq: 7 }))).toEqual({ status: 'accepted' });
      expect(ingress.accept(input({ seq: 7 }))).toEqual({ status: 'dropped' });
      expect(player(snapshot(), host.playerId).lastProcessedInputSeq).toBe(7);

- [ ] **Step 2: Run the ingress tests and confirm RED.**

      npx vitest run src/server/network/matchInputIngress.test.ts --maxWorkers=1

  Expected: failure because the ingress module does not exist.

- [ ] **Step 3: Implement the minimal ingress.**

  Move only the two input token buckets, `lastAcceptedInputSeq`, payload parsing, result-phase silence, domain error mapping, and unexpected-error logging out of `socketHandlers.ts`. Keep the low-frequency action bucket in `socketHandlers.ts`. `reset()` resets sequence and bucket timestamps for a newly established session; it must not bypass RoomManager's own queued/processed sequence guard.

- [ ] **Step 4: Replace the Socket.IO input body with the ingress.**

      const inputIngress = createMatchInputIngress({ connectionId: socket.id, rooms, now, logger });

      socket.on('match:input', (payload) => {
        const result = inputIngress.accept(payload);
        if (result.status === 'error') socket.emit('server:error', result.error);
      });

  Change the callback to `onSession(socket: GameSocket, welcome: SessionWelcome, inputIngress: MatchInputIngress): void` so `createGameServer.ts` can attach the same object to Task 5's transport session. Do not create a second WebRTC-specific limiter.

- [ ] **Step 5: Run focused and existing socket flow tests.**

      npx vitest run src/server/network/matchInputIngress.test.ts src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts --maxWorkers=1
      npm run typecheck

  Expected: all pass and existing result-warning suppression remains intact.

- [ ] **Step 6: Commit Task 2.**

      git add src/server/network/matchInputIngress.ts src/server/network/matchInputIngress.test.ts src/server/network/socketHandlers.ts src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts
      git commit -m "refactor: share authoritative match input ingress"

### Task 3: Order and De-duplicate Match Publications on the Client

**Files:**
- Create: `src/client/network/MatchPublicationSequencer.ts`
- Create: `src/client/network/MatchPublicationSequencer.test.ts`

**Interfaces:**
- Consumes: `MatchStartedPublication`, `MatchSnapshotPublication`, and `MatchEventPublication`.
- Produces: `createMatchPublicationSequencer()` for Task 6.

- [ ] **Step 1: Write failing sequencing tests.**

  Cover duplicate `match:started` safety copies; event 2 arriving before event 1 across different sources; an event and snapshot arriving before their start; stale epoch rejection; rematch reset; a resume start establishing a newer epoch from a non-zero `eventCursor`; a two-second gap fallback callback; and the 256-event cap.

      sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
      sequencer.acceptEvent(eventPublication(4, event({ eventId: 2 })));
      sequencer.acceptEvent(eventPublication(4, event({ eventId: 1 })));
      expect(publishedEvents.map((value) => value.eventId)).toEqual([1, 2]);

      sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
      expect(publishedStarts).toHaveLength(1);

- [ ] **Step 2: Run the sequencer tests and confirm RED.**

      npx vitest run src/client/network/MatchPublicationSequencer.test.ts --maxWorkers=1

- [ ] **Step 3: Implement the sequencer with injected timers.**

  Export:

      export function createMatchPublicationSequencer(options: Readonly<{
        onStarted: (snapshot: MatchSnapshot) => void;
        onSnapshot: (snapshot: MatchSnapshot) => void;
        onEvent: (event: GameEvent) => void;
        onTransportGap: () => void;
        setTimeoutFn?: typeof window.setTimeout;
        clearTimeoutFn?: typeof window.clearTimeout;
      }>): Readonly<{
        acceptStarted(publication: MatchStartedPublication): void;
        acceptSnapshot(publication: MatchSnapshotPublication): void;
        acceptEvent(publication: MatchEventPublication): void;
        dispose(): void;
      }>;

  Buffer by `matchEpoch` and `eventId`. Publish only contiguous events. A higher-epoch event or snapshot waits until the matching `match:started` safety publication establishes the epoch and sets `nextEventId = eventCursor + 1`; this prevents a fast-channel snapshot from overtaking the reliable start. Task 7 guarantees a resumed active session receives a fresh start publication with the current cursor. A two-second unresolved start/event gap calls `onTransportGap()`. Clear every timer and buffer idempotently on dispose.

- [ ] **Step 4: Run the sequencer tests and typecheck.**

      npx vitest run src/client/network/MatchPublicationSequencer.test.ts --maxWorkers=1
      npm run typecheck

- [ ] **Step 5: Commit Task 3.**

      git add src/client/network/MatchPublicationSequencer.ts src/client/network/MatchPublicationSequencer.test.ts
      git commit -m "feat: order duplicate match publications"

### Task 4: Implement and Prove the Node Werift Peer Adapter

**Files:**
- Create: `src/server/network/gameplayTransport/ServerPeer.ts`
- Create: `src/server/network/gameplayTransport/WeriftServerPeer.ts`
- Create: `src/server/network/gameplayTransport/WeriftServerPeer.test.ts`

**Interfaces:**
- Consumes: Werift 0.24.4 and the `ServerPeer` interface specified above.
- Produces: `createWeriftServerPeer(options): ServerPeer` and `readWebRtcUdpPortRange(env): readonly [number, number]`.

- [ ] **Step 1: Write failing adapter tests.**

  Test invalid environment values, equal min/max rejection because Werift forbids them, default `[53100, 53131]`, complete offer/answer, channel label/options, string message delivery, close notification, idempotent close, selected successful candidate-pair RTT conversion from seconds to rounded milliseconds, and `null` when stats have no fresh successful pair.

      expect(readWebRtcUdpPortRange({})).toEqual([53100, 53131]);
      expect(() => readWebRtcUdpPortRange({
        GAME_WEBRTC_UDP_PORT_MIN: '53100',
        GAME_WEBRTC_UDP_PORT_MAX: '53100'
      })).toThrow(/different/i);

- [ ] **Step 2: Run the adapter tests and confirm RED.**

      npx vitest run src/server/network/gameplayTransport/WeriftServerPeer.test.ts --maxWorkers=1

- [ ] **Step 3: Implement the Werift-only adapter.**

  Construct `new RTCPeerConnection({ iceServers: [], icePortRange: [min, max], iceUseIpv4: true })`. Subscribe to `peer.onDataChannel`; accept exactly `match-fast` and `match-reliable`, reject duplicate or unknown labels, and verify the fast channel reports `ordered === false` and `maxRetransmits === 0` while the reliable channel is ordered and fully reliable.

  Negotiation is:

      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      const local = await peer.setLocalDescription(answer);
      return { type: 'answer', sdp: local.sdp };

  Use `channel.onMessage.subscribe()`, `peer.connectionStateChange.subscribe()`, `channel.send(serialized)`, and `await peer.close()`. Keep every returned `unSubscribe` callback and release it in `close()`. `sendFast()` returns `backpressured` when `bufferedAmount > FAST_CHANNEL_MAX_BUFFERED_BYTES`, `closed` unless the channel is open, and `sent` only after `send()` succeeds. `sendReliable()` uses the same result type so the hub can distinguish temporary fast-channel pressure from a dead peer.

  `sampleRttMs()` iterates the `Map` returned by `peer.getStats()`, selects a `candidate-pair` report with `state === 'succeeded'`, `nominated !== false`, and a finite non-negative `currentRoundTripTime`, then returns `Math.round(seconds * 1000)`.

- [ ] **Step 4: Add one real browser-compatible offer fixture or live Chromium handshake test.**

  Mark the test file `// @vitest-environment node`, launch Chromium programmatically through `import { chromium } from '@playwright/test'`, and use `page.evaluate()` so the test proves current Chromium interop instead of pinning opaque SDP. The browser creates both channels, waits for ICE gathering completion, sends its local offer to `ServerPeer.negotiate()`, applies the answer, opens the channels, and exchanges one message in each direction. Close the page, browser, and server peer in `finally`.

- [ ] **Step 5: Run adapter tests repeatedly and verify port release.**

      npx vitest run src/server/network/gameplayTransport/WeriftServerPeer.test.ts --maxWorkers=1
      npx vitest run src/server/network/gameplayTransport/WeriftServerPeer.test.ts --maxWorkers=1
      npm run typecheck

  Expected: both runs pass; the second run proves UDP sockets were released.

- [ ] **Step 6: Commit Task 4.**

      git add src/server/network/gameplayTransport/ServerPeer.ts src/server/network/gameplayTransport/WeriftServerPeer.ts src/server/network/gameplayTransport/WeriftServerPeer.test.ts
      git commit -m "feat: add authoritative Node WebRTC peer"

### Task 5: Build the Server Gameplay Transport Hub

**Files:**
- Create: `src/server/network/gameplayTransport/GameplayTransportHub.ts`
- Create: `src/server/network/gameplayTransport/GameplayTransportHub.test.ts`

**Interfaces:**
- Consumes: `ServerPeerFactory`, shared envelopes, `MatchInputIngress`, per-session Socket.IO emit callbacks, and network-state callbacks.
- Produces: the `GameplayTransportHub` interface specified above.

- [ ] **Step 1: Write failing fake-peer hub tests.**

  Build a fake peer with controllable ready state, inbound messages, stats, and close. Prove session-scoped negotiation; replacement closes the previous generation; five-second activation timeout; activation only after both channels are open; fast input enters the exact registered ingress; wrong generation/epoch/oversized/malformed input is rejected; active snapshots use only fast WebRTC; fallback snapshots use Socket.IO; start/events use reliable WebRTC plus Socket.IO safety copies; close and three missed heartbeats trigger one fallback; detach/stop are idempotent; one peer cannot influence another session; Ping samples every two seconds and expire after six.

      hub.attachSession(session({ socketId: 's1', playerId: 'p1', roomCode: 'AB2Z' }));
      const generationId = '2f8ca1f2-7e6e-4ea7-90e2-e6a955892574';
      await hub.negotiate('s1', negotiation(generationId));
      fakePeer.openBothChannels();
      expect(hub.activate('s1', { generationId })).toBe(true);
      fakePeer.receiveFast(clientInput({ generationId, matchEpoch: 2, seq: 9 }));
      expect(sessionIngress.accept).toHaveBeenCalledOnce();

- [ ] **Step 2: Run hub tests and confirm RED.**

      npx vitest run src/server/network/gameplayTransport/GameplayTransportHub.test.ts --maxWorkers=1

- [ ] **Step 3: Implement one state record per Socket.IO session.**

  Each record stores identity, room, ingress, current epoch, generation, peer, mode, heartbeat nonce/miss count, five RTT samples with timestamps, intervals/timeouts, and disposal state. No browser payload may change identity or room. Serialization failures, send failures, and peer failures call the same idempotent `fallback()` transition.

- [ ] **Step 4: Implement publication routing.**

  For `MATCH_STARTED`, set the session epoch and send the reliable envelope when active; always emit the Socket.IO safety publication. For `MATCH_EVENT`, do the same without changing epoch. For `MATCH_SNAPSHOT`, `sent` completes WebRTC delivery, `backpressured` drops only that intermediate snapshot so the next one can catch up, and `closed` immediately falls back and sends that same snapshot through Socket.IO. A reliable-channel `backpressured` or `closed` result falls back because its Socket.IO safety copy already preserves the critical publication.

- [ ] **Step 5: Implement heartbeat and Ping sampling.**

  Heartbeat once per second on reliable, accept only the matching nonce, and fallback on the third missed acknowledgement. Sample server-side Werift stats every two seconds only while active, keep five samples, call the room network callback with the median and sample timestamp, and clear the WebRTC value on fallback. Trigger the registered immediate Socket.IO probe callback during fallback.

- [ ] **Step 6: Run hub tests and a leak-focused fake-timer loop.**

      npx vitest run src/server/network/gameplayTransport/GameplayTransportHub.test.ts --maxWorkers=1
      npm run typecheck

  Expected: no pending fake timers after `stop()` and every peer's close count is exactly one.

- [ ] **Step 7: Commit Task 5.**

      git add src/server/network/gameplayTransport/GameplayTransportHub.ts src/server/network/gameplayTransport/GameplayTransportHub.test.ts
      git commit -m "feat: route gameplay through per-player WebRTC peers"

### Task 6: Build the Browser Gameplay Transport and Integrate GameClient

**Files:**
- Create: `src/client/network/GameplayTransport.ts`
- Create: `src/client/network/GameplayTransport.test.ts`
- Modify: `src/client/network/GameClient.ts`
- Modify: `src/client/network/GameClient.test.ts`

**Interfaces:**
- Consumes: Task 1 wire types, Task 3 sequencer, Socket.IO negotiation functions, and the browser `RTCPeerConnection` API.
- Produces: `createGameplayTransport()` and unchanged public `GameClient` methods/events.

- [ ] **Step 1: Write failing browser-controller tests with an injected peer.**

  Prove unsupported `RTCPeerConnection` stays on Socket.IO; fast/reliable channel options are exact; offer waits for ICE gathering or three-second timeout; answer applies only to the matching generation; activation occurs only after both channels open; `sendInput()` uses WebRTC only after the server mode notice; channel close/failure/heartbeat gap calls fallback once; stale peer messages are ignored; disconnect/leave dispose; and a lobby/rematch transition may negotiate one fresh generation.

      expect(fakePeer.createDataChannel).toHaveBeenCalledWith('match-fast', {
        ordered: false,
        maxRetransmits: 0
      });
      expect(fakePeer.createDataChannel).toHaveBeenCalledWith('match-reliable', {
        ordered: true
      });

- [ ] **Step 2: Run controller and GameClient tests and confirm RED.**

      npx vitest run src/client/network/GameplayTransport.test.ts src/client/network/GameClient.test.ts --maxWorkers=1

- [ ] **Step 3: Implement `createGameplayTransport()`.**

  Export a dependency-injected controller:

      export function createGameplayTransport(options: Readonly<{
        createPeer?: () => RTCPeerConnection;
        negotiate: (request: RtcNegotiationRequest) => Promise<Ack<RtcNegotiationAnswer>>;
        activate: (request: RtcActivationRequest) => Promise<Ack<TransportModeNotice>>;
        notifyFallback: () => void;
        sequencer: MatchPublicationSequencer;
        now?: () => number;
      }>): Readonly<{
        start(): Promise<void>;
        acceptMode(notice: TransportModeNotice): void;
        acceptSocketStarted(value: MatchStartedPublication): void;
        acceptSocketSnapshot(value: MatchSnapshotPublication): void;
        acceptSocketEvent(value: MatchEventPublication): void;
        sendInput(input: InputFrame): boolean;
        dispose(): void;
      }>;

  Browser peer configuration is `{ iceServers: [] }`. Create both channels before `createOffer()`, set the local offer, wait for `iceGatheringState === 'complete'` or three seconds, call the acknowledged Socket.IO negotiation, set the answer, wait for both channels, then activate. A `true` return from `sendInput()` means the WebRTC message was sent. Return `false` when mode is fallback, the channel is not open, serialization exceeds 8 KiB, `bufferedAmount` exceeds 256 KiB, or `send()` throws; `GameClient` then sends that input exactly once through Socket.IO.

  The reliable-channel handler sends a `heartbeat-ack` with the received nonce, routes `started` and `event` envelopes into the sequencer, and ignores stale generations. The fast handler routes current-generation snapshots. On a local channel close/failure, set local arbitration to the current Socket.IO transport immediately, emit `transport:fallback` once, and wait for the server's `transport:mode` notice without pausing input.

- [ ] **Step 4: Integrate with `GameClient` without changing its public API.**

  Construct one sequencer and controller per `GameClient`. On `session:welcome`, start negotiation. Route Socket.IO match publications into the sequencer through the controller. Route DataChannel publications into the same sequencer. On `transport:mode`, update arbitration. Implement:

      sendInput(input: InputFrame): void {
        if (!gameplayTransport.sendInput(input)) socket.emit('match:input', input);
      }

  Dispose on explicit disconnect, leave success, non-resumable disconnect, and replacement session. A recoverable Socket.IO reconnect must negotiate a new generation after `session:welcome`/resume rather than reuse the stale peer.

- [ ] **Step 5: Run focused client tests and typecheck.**

      npx vitest run src/client/network/GameplayTransport.test.ts src/client/network/MatchPublicationSequencer.test.ts src/client/network/GameClient.test.ts --maxWorkers=1
      npm run typecheck

- [ ] **Step 6: Commit Task 6.**

      git add src/client/network/GameplayTransport.ts src/client/network/GameplayTransport.test.ts src/client/network/GameClient.ts src/client/network/GameClient.test.ts
      git commit -m "feat: arbitrate browser gameplay transport"

### Task 7: Integrate Match Epochs, Publications, Lifecycle, and Honest Ping

**Files:**
- Modify: `src/server/rooms/roomManager.ts`
- Modify: `src/server/rooms/roomManager.test.ts`
- Modify: `src/server/network/socketHandlers.ts`
- Modify: `src/server/network/createGameServer.ts`
- Modify: `src/server/network/createGameServer.test.ts`
- Modify: `tests/integration/socketFlow.test.ts`
- Modify: `tests/integration/serverLifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: real end-to-end server routing, test-harness transport controls, epoch/cursor publications, mode-aware Ping, and complete cleanup.

- [ ] **Step 1: Write failing RoomManager tests for epochs and Ping freshness.**

  Add `matchEpoch` to each Room, initialize it to 0, increment before each new `createMatchState()`, and add `matchEpoch` plus `eventCursor = room.match.nextEventId - 1` to match publications. Tests must prove rematch increments exactly once, host migration does not change it, and reconnect retains it.

  Extend `PlayerNetworkRuntime` with `sampledAtMs`. Change `setPing(connectionId, pingMs, source, sampledAtMs)` so samples are accepted only from the current mode, capped at five, and exposed as null after six seconds. Changing transport clears samples immediately.

      rooms.setTransport('host-socket', 'webrtc');
      rooms.setPing('host-socket', 12, 'webrtc', 1_000);
      expect(networkAt(6_999).medianMs).toBe(12);
      expect(networkAt(7_001).medianMs).toBeNull();

- [ ] **Step 2: Run RoomManager tests and confirm RED.**

      npx vitest run src/server/rooms/roomManager.test.ts --maxWorkers=1

- [ ] **Step 3: Implement epoch/cursor and mode-aware Ping.**

  Keep `matchEpoch` outside `MatchState`; it belongs to room/session publication. Keep `sampledAtMs` internal; the public `PlayerNetworkStatus` remains `currentMs`, `medianMs`, `jitterMs`, and `transport`. `snapshotForRoom()` calls a freshness helper using `this.deps.now()` and emits null values when stale.

  The existing Socket.IO probe calls `setPing(socket.id, measuredMs, currentTransport(socket), now())`. Its samples are ignored while RoomManager says the player is on `webrtc`. On fallback, the hub first switches transport and clears samples, then invokes the socket handler's immediate probe callback.

- [ ] **Step 4: Add signaling and shared-ingress socket handlers.**

  Register acknowledged `transport:negotiate` and `transport:activate` using the existing action limiter and safe ack error shape. `transport:fallback` is session-scoped and idempotent. `establishSession()` attaches exactly one hub session with the same `MatchInputIngress`; leave/disconnect detaches it. The hub, not client input, changes RoomManager transport mode.

- [ ] **Step 5: Replace room-wide match dispatch with hub routing.**

  Instantiate one hub in `createGameServer()`. Continue `io.to(roomCode).emit('room:state', state)`. For started/snapshot/event publications, call `hub.publish(publication)`. The hub sends Socket.IO safety/fallback messages to explicit socket IDs held in its authenticated session map. On `ROOM_CLOSED`, detach every session in that room.

  Add a read-only RoomManager method that returns the current `MatchStartedPublication` for a connected active-match session. After `session:resume`, emit that publication to the resumed socket before later snapshots; set its `eventCursor` to `room.match.nextEventId - 1`. This gives the client sequencer an epoch boundary without replaying already-consumed visual events.

- [ ] **Step 6: Expose test-only transport controls.**

  Under `enableTestHarness`, add:

      transportMode(playerId: string): GameplayTransportMode | null;
      dropWebRtc(playerId: string): Promise<void>;

  Do not expose these routes over HTTP or production Socket.IO. They are in-process test helpers only.

- [ ] **Step 7: Prove lifecycle and fallback integration.**

  Add tests for negotiation failure staying on Socket.IO, duplicate same-sequence input across both ingress paths, immediate snapshot fallback after a forced send failure, peer replacement on resume, peer closure on leave/disconnect/server stop, UDP reuse after restart, and rematch epoch/activation. Existing pure Socket.IO clients must still complete the full integration suite without negotiating WebRTC.

- [ ] **Step 8: Run server/integration tests and full unit suite.**

      npx vitest run src/server/rooms/roomManager.test.ts src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts tests/integration/serverLifecycle.test.ts --maxWorkers=1
      npm test
      npm run typecheck

- [ ] **Step 9: Commit Task 7.**

      git add src/server/rooms/roomManager.ts src/server/rooms/roomManager.test.ts src/server/network/socketHandlers.ts src/server/network/createGameServer.ts src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts tests/integration/serverLifecycle.test.ts
      git commit -m "feat: activate authoritative WebRTC gameplay routing"

### Task 8: Finish the HUD, Real-Browser Proof, Load Gate, and LAN Documentation

**Files:**
- Modify: `src/client/ui/MatchHud.tsx`
- Modify: `src/client/ui/MatchHud.test.tsx`
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/webrtcGameplay.spec.ts`
- Modify: `tests/e2e/networkFallback.spec.ts`
- Modify: `tests/e2e/mobile.spec.ts`
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `tests/load/eightClients.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-01-webrtc-gameplay-transport.md`

**Interfaces:**
- Consumes: the complete gameplay transport and test harness.
- Produces: user-visible one-Ping HUD, real Chromium evidence, fallback/load/performance evidence, and reproducible LAN instructions.

- [ ] **Step 1: Write failing HUD tests for one Ping field.**

  Replace `PING/RTT` with `PING`; render `medianMs` as the sole value; show `Ping —` when null; preserve good/medium/high thresholds; show the same values to local and remote clients; and assert the roster contains none of `RTT`, `Delay`, `Rollback`, or `RB`.

      expect(within(roster).getByText('PING')).toBeVisible();
      expect(within(roster).getByLabelText('Linus ağ telemetrisi: Ping 18 ms')).toBeVisible();
      expect(roster).not.toHaveTextContent(/RTT|Delay|Rollback|\bRB\b/);

- [ ] **Step 2: Run HUD tests and confirm RED, then implement the minimal presentation.**

      npx vitest run src/client/ui/MatchHud.test.tsx --maxWorkers=1

  `pingPresentation()` uses only fresh `medianMs`, returns `Ping —` for null, and keeps the current compact roster width.

- [ ] **Step 3: Add the real WebRTC browser acceptance test.**

  `tests/e2e/webrtcGameplay.spec.ts` creates two real pages with `createTwoPlayerMatch()`, waits until both `game.harness.transportMode(playerId)` values equal `webrtc`, sends movement/quick/heavy input from a browser, and waits for `lastProcessedInputSeq` and authoritative action changes. Assert both player rows contain one numeric Ping and no console/server errors.

  Force one peer closed with `await game.harness.dropWebRtc(guestPlayerId)`. Assert its mode becomes `websocket` or `polling`, send another attack without reloading, and prove the authoritative sequence advances. Return to lobby, rematch, and prove a fresh WebRTC generation activates.

- [ ] **Step 4: Add explicit unsupported-browser and mobile fallback coverage.**

  In a separate context, replace `window.RTCPeerConnection` with `undefined` before page code. Join and play over Socket.IO without a toast or fatal error. Keep the existing WebSocket-to-polling test unchanged. Add one mobile landscape smoke that accepts either active WebRTC or clean Socket.IO fallback and proves touch input advances the authoritative sequence.

- [ ] **Step 5: Preserve and extend load/performance gates.**

  Keep `tests/load/eightClients.test.ts` as an eight-client Socket.IO fallback gate. In Playwright performance coverage, use one real WebRTC browser plus seven lightweight Socket.IO companions; record input submission time, the first authoritative snapshot with the processed sequence, median latency, p95 latency, frame median, and p95 frame duration. Ring-out effects must retain the existing frame-budget assertions.

  The automated gate fails on functional regressions and resource leaks. Record the WebRTC-versus-Socket.IO latency comparison as an artifact; do not invent a universal 20 ms threshold for CI running on one machine.

- [ ] **Step 6: Update LAN documentation.**

  Add UDP `53100–53131` to macOS/Windows/Linux firewall guidance, show both environment override names, state that WebRTC is host-candidate LAN-only with automatic Socket.IO fallback, explain guest-Wi-Fi/client-isolation limitations, and define Ping as WebRTC candidate-pair RTT while active and application RTT while on fallback.

- [ ] **Step 7: Run every verification gate.**

      npm run lint
      npm run typecheck
      npm test
      npm run test:load
      npm run build
      npm run test:e2e
      npm run verify

  Expected: every command exits 0. `npm run verify` must include all Vitest tests, the eight-client load gate, and production build. `npm run test:e2e` must include active WebRTC, forced fallback, rematch, mobile smoke, and performance/ring-out coverage.

- [ ] **Step 8: Perform live host verification.**

  Start the exact production profile:

      npm run lan

  Verify process/listener ownership and both HTTP probes:

      curl --fail http://127.0.0.1:4173/health
      curl --fail http://<printed-private-address>:4173/health

  In two real browser pages, create/join through `/room/CODE`, play, force no artificial failure, and observe numeric Ping. Report localhost acceptance, private-address reachability, and another-physical-device acceptance as separate facts.

- [ ] **Step 9: Update the living plan and commit Task 8.**

  Fill `Progress`, `Surprises & Discoveries`, and `Outcomes & Retrospective` with exact test totals, observed transport modes, measured latency summaries, and any unperformed physical-device gate.

      git add src/client/ui/MatchHud.tsx src/client/ui/MatchHud.test.tsx tests/e2e tests/load/eightClients.test.ts README.md docs/superpowers/plans/2026-09-01-webrtc-gameplay-transport.md
      git commit -m "test: verify WebRTC LAN gameplay transport"

- [ ] **Step 10: Review, publish, and merge.**

  Invoke `superpowers:requesting-code-review`, address feedback through `superpowers:receiving-code-review`, re-run the full gates, then invoke `superpowers:finishing-a-development-branch`. Push the verified feature branch, merge it to public `main`, verify `origin/main` contains the final commit, and restart the LAN server from that exact revision. Do not include the abandoned browser-to-browser working-tree prototype in any commit.

## Concrete Steps

Execution starts from `/Users/serkances/dev/game`, but code work must occur in a clean worktree created from the branch containing this plan and spec. The current directory's uncommitted RTT prototype is preserved until the clean worktree is active; it is not copied, committed, or used as a baseline.

At each task boundary, run `git status --short`, confirm only task-owned files changed, run the task's focused tests, and commit. Update the `Progress` section in the same task commit. If a task discovers a design contradiction, stop that task, record it in `Surprises & Discoveries` and `Decision Log`, update the plan so it remains self-contained, then continue.

## Validation and Acceptance

The implementation is accepted only when a real Chromium browser connects to the authoritative Node Werift endpoint, both DataChannels open, input changes authoritative state, snapshots reconcile the client, reliable game events remain ordered despite Socket.IO safety copies, and Ping comes from a fresh server-side candidate-pair RTT.

The failure path is equally mandatory: with WebRTC absent, negotiation rejected, or a channel dropped mid-match, the player stays in the room, input continues through Socket.IO, the next authoritative snapshot arrives, Ping switches to a fresh fallback sample, and no duplicate attack/KO/ring-out/result is presented.

Room create/join/invite, ready/settings, host migration, leave, reconnect/resume, result, return-to-lobby, rematch, mobile controls, eight-player load, ring-out performance, server stop/restart, typecheck, lint, unit/integration/load tests, production build, and Playwright must all retain their gates.

A localhost browser test proves software behavior. A successful private-address health probe proves LAN listener reachability. Only a second physical device playing the match proves live LAN acceptance. Report these separately.

## Idempotence and Recovery

Every peer, subscription, timer, and UDP socket closes idempotently. Repeating server start/stop tests must reuse the configured UDP range successfully. Repeating negotiation replaces and closes the old generation. Repeating activation or fallback does not emit duplicate mode transitions. Repeating the same input `seq`, snapshot `tick`, or event `eventId` has no second effect.

If Werift negotiation fails, do not restart the room or server; keep Socket.IO active and record the failure through the existing logger without exposing raw SDP. If a task fails partway, keep its failing test and implementation together, fix forward, and do not use destructive repository resets. The clean worktree isolates implementation from the original uncommitted prototype.

## Artifacts and Notes

Keep final evidence concise and checked into the living plan: focused/full test totals, two-browser transport modes, forced-fallback sequence advancement, repeated port-release test, eight-player load result, frame and input-latency summary, production build revision, local/private health statuses, and whether a second physical device was actually used.

The feature is not complete merely because the displayed number decreases. The WebRTC path must carry real input and snapshots, preserve authoritative outcomes, survive fallback, and show an improvement in representative input-to-authoritative-snapshot latency or its high-percentile spikes.
