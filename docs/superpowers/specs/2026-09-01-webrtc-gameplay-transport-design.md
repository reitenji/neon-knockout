# WebRTC Gameplay Transport Design

Date: 2026-09-01
Status: Approved in chat; awaiting written-spec review

## Purpose

Neon Relay currently carries every active-match message through Socket.IO. That path is reliable and easy to operate, but it also places latency-sensitive input and snapshot packets on a TCP-based application channel. A delayed old packet can hold newer data behind it, and the current browser acknowledgement probe includes JavaScript scheduling time. The result is a displayed application RTT around 90–100 ms in cases where the physical LAN path is much faster.

The accepted direction is to move active-match traffic between each browser and the authoritative Node.js process to WebRTC DataChannels. Socket.IO remains the control plane for room and session operations, WebRTC negotiation, and an automatic compatibility fallback. The game remains server-authoritative; browsers never simulate authority for other players and never connect to the room owner's browser as their gameplay server.

The user-visible outcome is that a supported client normally plays over a UDP-based WebRTC path, sees one `Ping` value derived from that path, and automatically stays playable over Socket.IO if WebRTC cannot be established or fails.

## Scope

This design includes:

- one browser-to-Node WebRTC peer connection per connected player session;
- WebRTC transport for match input, authoritative snapshots, match start, and game events;
- Socket.IO signaling, lobby/control traffic, and automatic gameplay fallback;
- server-owned transport selection, reconnection cleanup, validation, rate limiting, and stale-packet rejection;
- a single Ping value in the match player list, measured from the currently active gameplay path;
- deterministic unit and integration tests plus real Chromium-to-Node acceptance tests;
- LAN-first operation with a fixed UDP port range.

This design does not include:

- peer-to-peer browser game authority;
- browser-to-room-host gameplay or RTT measurement;
- TURN, cloud relay, Firebase, or internet matchmaking;
- replacing Socket.IO for lobby, room, settings, ready, result, or session-resume operations;
- rollback-netcode changes, simulation rewrites, or C++/WebAssembly work;
- silently trusting client-submitted ping or game-state values.

## Architectural Choice

Three approaches were considered.

The selected approach is a hybrid control/data plane. Socket.IO remains connected for reliable low-frequency operations and signaling, while WebRTC carries the active match. This gives the game UDP-based, partially reliable delivery where newer packets matter more than old ones, while preserving current room and reconnect behavior. If WebRTC fails, the same match continues over Socket.IO without user intervention.

A WebRTC-only application was rejected. WebRTC still needs an application-provided signaling path, and removing Socket.IO would require replacing a working room/session protocol without improving its low-frequency operations.

A measurement-only WebRTC connection was also rejected. Adding a second real-time protocol solely to display a smaller number would not improve gameplay latency and would not justify the lifecycle and dependency cost.

## System Boundaries

The authoritative simulation remains in the Node.js server. `src/server/rooms/roomManager.ts` continues to own room membership, accepted input, match advancement, and publications. `src/server/game/` remains unaware of Socket.IO and WebRTC.

A new server-side `GameplayTransportHub` owns WebRTC peers and chooses how each player receives and sends match traffic. A new client-side `GameplayTransport` owns negotiation, DataChannels, encoding, health, and fallback state. Neither component owns game rules.

`src/server/network/socketHandlers.ts` must expose one shared input-ingress function. Both Socket.IO `match:input` and the WebRTC fast channel call this function so validation, input rate limits, monotonic `seq` rejection, result-phase handling, and domain errors cannot drift between transports.

`src/server/network/createGameServer.ts` must route match publications through `GameplayTransportHub`. Room state and other control-plane publications continue through Socket.IO exactly as they do today.

## Connection Topology and Signaling

Each browser connects directly to the authoritative Node.js process. The room owner's browser has no special transport role, and host migration does not rebuild other players' peers.

Negotiation starts only after `room:create`, `room:join`, or `session:resume` has established a player identity on the current Socket.IO connection. The browser creates one `RTCPeerConnection`, creates the two agreed DataChannels, gathers host ICE candidates, and sends a complete SDP offer through an acknowledged Socket.IO negotiation event. The Node server creates a Werift peer bound to that socket's authenticated player session, applies the offer, gathers candidates, and returns a complete SDP answer. Non-trickle ICE is selected for the first implementation because the LAN topology is small, it avoids candidate-order races, and it was proven in a Chromium-to-Werift feasibility probe.

The offer payload has no target player identifier. A Socket.IO client may negotiate only its own Node peer. Every negotiation carries a random `generationId`; late answers or packets from an earlier generation are ignored.

The server uses the pinned pure TypeScript dependency `werift@0.24.4` rather than a native C++ binding. The default UDP range is `53100–53131`, configurable through `GAME_WEBRTC_UDP_PORT_MIN` and `GAME_WEBRTC_UDP_PORT_MAX`. This is enough for the game's maximum eight players with recovery headroom and gives the host a predictable firewall rule.

The initial LAN release uses host candidates only and configures no STUN or TURN servers. Networks that block UDP, isolate Wi-Fi clients, or prevent usable ICE candidates use the Socket.IO fallback.

## DataChannels and Wire Messages

Each peer has two bidirectional channels.

`match-fast` is unordered with `maxRetransmits: 0`. The browser sends `InputFrame` messages on this channel. The server sends `MatchSnapshot` messages on it. An old input is already rejected by its monotonic `seq`; an old snapshot is rejected by its `tick`. Losing either packet is preferable to delaying newer state behind it.

`match-reliable` is ordered and reliable. The server sends `match:started` and every `GameEvent` on this channel. These low-frequency critical publications are also sent through Socket.IO as an eventual-delivery safety copy. The first copy received is buffered, but publication to game consumers remains strictly ordered as described below. This preserves the faster WebRTC arrival without creating an event-replay subsystem for an abrupt channel loss. Rare transport-control messages such as WebRTC activation may also use this channel.

The first implementation uses UTF-8 JSON envelopes and existing shared model shapes. This matches the current Socket.IO serialization and avoids adding a binary codec before measurements show it is necessary. Every inbound envelope is size-limited, versioned, parsed, and validated with Zod before it reaches game code. A client-to-server DataChannel message may not exceed 8 KiB, and a negotiation SDP payload may not exceed 128 KiB.

The envelope contains:

- protocol version;
- `generationId`;
- a server-assigned `matchEpoch` that increments for every match in a room;
- message kind;
- the existing typed payload.

The transport never accepts room code, player ID, target player ID, score, damage, or authoritative position from an input packet. Player identity comes exclusively from the server-side peer-to-Socket.IO session binding.

## Activation, Fallback, and Duplicate Safety

Socket.IO is the baseline transport immediately after joining. WebRTC negotiation runs without blocking the lobby. Browser candidate gathering may use at most three seconds, and the complete negotiation plus channel activation may use at most five seconds. A peer becomes active only after both DataChannels are open and the server and client complete an activation handshake.

The server is authoritative for the active transport mode of each player. During activation or failure, the two transports may briefly overlap to prevent an input gap. Duplicate and ordering safety uses the transport envelope plus data already present in the protocol:

- input is accepted once by monotonic `seq`;
- snapshots are accepted only when `tick` advances;
- match publications from an older `matchEpoch` are discarded;
- `match:started` resets the client event cursor to `eventId` 1 for its `matchEpoch`;
- events from WebRTC and Socket.IO enter one per-match reorder buffer keyed by `eventId`;
- the client publishes only the contiguous sequence beginning at its next expected `eventId`, dropping older duplicates;
- an event received before `match:started` waits in that match epoch's buffer;
- the reorder buffer is capped at 256 events; a gap that remains for two seconds or reaches the cap disables WebRTC for that player and lets the ordered Socket.IO safety copies fill and drain the gap;
- packets from an obsolete `generationId` are discarded.

When WebRTC is active, the client sends match input over `match-fast`. The server sends that client snapshots over `match-fast` and starts/events over `match-reliable`. The rare start/event safety copies and all control-plane events remain on Socket.IO.

While WebRTC is active, the reliable channel exchanges a lightweight heartbeat once per second. If either DataChannel closes, the peer connection fails, activation times out, or three consecutive heartbeats are missed, both sides immediately return match traffic to Socket.IO. The player remains in the room and the simulation continues. WebRTC is not renegotiated repeatedly during the same active match; the next lobby/countdown transition or a resumed Socket.IO session may start one fresh generation.

The fallback is deliberately automatic. A browser with unsupported or restricted WebRTC must not be prevented from joining or playing.

## Lifecycle

The WebRTC peer is owned by the current Socket.IO session and is closed idempotently when:

- the player explicitly leaves the room;
- the Socket.IO connection disconnects;
- a resume operation replaces the old connection;
- a new negotiation generation supersedes it;
- the room closes;
- the game server stops.

Result, rematch, and return-to-lobby transitions do not reuse stale channel state. A healthy peer may remain connected across a rematch, but activation is re-confirmed for the new match. Intervals, listeners, pending negotiations, and UDP resources must all be released on disposal.

## Ping Semantics and HUD

The match list displays one field named `Ping` for every player, including the local player.

For an active WebRTC player, Ping is the server-clock application RTT of the existing reliable DataChannel heartbeat: the authoritative Node server timestamps a heartbeat when it sends it and measures the elapsed time when the browser returns the matching acknowledgement. Unlike ICMP, this application measurement includes browser and Node scheduling as well as transport time. Only a distinct acknowledgement matching the currently pending heartbeat enters the latest-five median published in the existing network status included with authoritative snapshots. A sample is valid for six seconds. When no fresh sample exists, Ping is an em dash. The client never supplies the authoritative displayed value.

For a player entering Socket.IO fallback, the old WebRTC sample is cleared and an application RTT probe is requested immediately, then every two seconds. Ping remains an em dash until the first fresh fallback sample arrives. The UI still shows only one Ping field; transport mode is retained in the network model for diagnostics and tests rather than adding another wide HUD column.

An unavailable sample renders as an em dash. Values are clamped to a sane display range, but the UI never rescales or disguises a high value.

## Security and Abuse Resistance

WebRTC does not weaken the authoritative model. The server binds a peer to the player already authenticated by the Socket.IO resume token and ignores client-supplied identity. Negotiation payloads and DataChannel messages have strict schema and byte-size limits. Offer frequency, input frequency, and malformed-message frequency are rate-limited.

The same input validator and limiter handle both transports. A client cannot submit input for another player, set its own ping, forge room publications, or relay signaling to another browser. Unexpected SDP, invalid envelopes, obsolete generations, and packets received before activation are rejected without crashing the room.

## Mobile and LAN Behavior

Desktop Chromium is the primary acceptance browser for the first transport implementation. Mobile Chrome and Safari receive smoke coverage. WebRTC support differences or local-network permission restrictions are handled by Socket.IO fallback rather than browser-specific gameplay logic.

This transport can reduce stale-packet waiting and application-layer queueing, but it does not guarantee a fixed sub-20 ms value. Simulation tick rate, browser scheduling, Wi-Fi interference, device power saving, and rendering still affect perceived input response. Success is measured on representative LAN devices by both transport RTT and input-to-authoritative-snapshot latency.

## Implementation Sequence

Implementation must grow in verifiable layers without replacing a working game with an unfinished transport.

First, isolate the shared input-ingress and publication-routing boundaries while keeping all behavior on Socket.IO. Existing tests must remain green.

Second, add the Werift Node endpoint and a real Chromium negotiation test. No gameplay traffic moves until peer creation, channel opening, cleanup, and fixed-port configuration are proven.

Third, add the fast channel for input and snapshots with duplicate protection and automatic Socket.IO fallback.

Fourth, add the reliable channel for match start and game events, then verify event ordering and rematch behavior.

Finally, switch Ping to the active transport source, run multi-client load and browser acceptance, document the LAN UDP requirement, and remove the abandoned browser-to-browser measurement prototype rather than maintaining two WebRTC topologies.

## Testing Strategy

Unit tests cover the client and server transport state machines, negotiation timeout, activation, close/error fallback, generation replacement, idempotent disposal, JSON envelope limits, Zod validation, duplicate rejection by `seq`, `tick`, and `eventId`, cross-transport event reordering and gap timeout, and Ping sample freshness across a fallback.

Server tests inject a fake peer factory so most lifecycle and routing behavior is deterministic. Existing Socket.IO integration tests continue proving room, lobby, reconnect, rematch, input limits, and result behavior.

A real integration test creates a Werift peer on Node and a Chromium `RTCPeerConnection`, opens both channels, exchanges representative input/snapshot/event messages, and confirms a non-null candidate-pair RTT when the browser exposes it.

End-to-end tests cover:

- two browser clients joining and playing with WebRTC active;
- forced negotiation failure with uninterrupted Socket.IO gameplay;
- a mid-match DataChannel closure with automatic fallback;
- reconnect/resume, leave, result, return-to-lobby, and rematch cleanup;
- local and remote rows showing exactly one Ping value;
- mobile browser or emulation smoke behavior;
- four-to-eight clients without snapshot starvation or resource leaks.

Performance acceptance compares the old Socket.IO path and the WebRTC path on the same representative LAN. The WebRTC path must improve median input-to-authoritative-snapshot latency or materially reduce its high-percentile spikes. A smaller displayed RTT alone is not sufficient evidence.

## Acceptance Criteria

The design is complete when all of the following are observable:

- A supported browser reports an active WebRTC gameplay transport connected directly to Node.
- Input, snapshots, match start, and game events use the agreed DataChannels while active.
- Disabling or breaking UDP leaves the player in the same playable match over Socket.IO.
- No duplicate hit, KO, ring-out, result, or input occurs during activation or fallback.
- Room join, ready, settings, leave, resume, result, rematch, and host migration retain their current behavior.
- Every player row shows one honest Ping value or an em dash.
- A real LAN comparison measures gameplay latency rather than inferring success from the label.
- Unit, integration, load, typecheck, build, and browser suites pass.
- The public GitHub repository contains the implementation and LAN setup documentation.

## Approved Decisions

- WebRTC will carry real gameplay traffic rather than exist only as a latency probe.
- The connection target is the authoritative Node process, never the room owner's browser.
- Socket.IO remains the control plane and automatic compatibility fallback.
- The first release is LAN-only and adds neither STUN nor TURN.
- WebRTC failure must not penalize or eject the player.
- The implementation will use pure TypeScript Werift on Node.
- The HUD will show one Ping field, not separate Ping/RTT/delay/rollback columns.
