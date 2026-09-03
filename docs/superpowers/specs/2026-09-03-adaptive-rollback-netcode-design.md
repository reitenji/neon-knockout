# Adaptive Rollback Netcode Design

**Status:** Approved direction; implementation plan pending review

**Goal:** Keep every player's local controls immediate while adapting remote presentation and bounded combat lag compensation to that player's measured gameplay-path RTT and jitter.

## User outcome

Players on a healthy LAN should retain the current immediate response. A player on a less stable 50-150 ms Wi-Fi path should see continuous remote motion instead of uneven snapshot steps, should keep immediate local movement and attack anticipation, and should receive authoritative corrections without visible teleports during ordinary play. A late but valid melee input may use a bounded historical target hitbox, but it must never undo an already published score, knockout, projectile result, or match result.

## Terms

The simulation runs at 60 ticks per second, so one frame is approximately 16.67 ms.

`Delay frames` means the number of complete authoritative snapshot frames retained by a client before presenting remote players. This is a jitter buffer. It is not artificial keyboard delay.

`Rollback frames` means the maximum recent span that may be replayed or inspected. On the client, pending local inputs are replayed from an authoritative snapshot. On the server, combat validation may inspect historical player hitboxes. The server does not restore and republish an old whole-world state.

`Reconciliation` means applying the newest authoritative local-player state and replaying still-unacknowledged local inputs to return to the client's predicted present.

`Combat rewind` means testing a melee contact against a bounded historical target pose representing what the attacker was allowed to see. It does not rewind scores, events, projectiles, clocks, or room lifecycle.

## Existing architecture

The Node.js server owns the 60 Hz match state and processes the latest monotonic `InputFrame` for each player. Both WebRTC and Socket.IO feed the same authoritative ingress. The client predicts only its own kinematics and action starts, then reconciles pending inputs when snapshots acknowledge their sequence. Remote players are rendered from `SnapshotTimeline`, which currently retains eight snapshots and chooses a 16-24 ms arrival-jitter delay. The bridge already carries internal presentation-delay and rollback-span telemetry, while the product HUD intentionally displays only Ping.

This design retains the authoritative server, WebRTC fast path, Socket.IO fallback, latest-wins snapshot pacing, Phaser renderer, React HUD, and existing event sequencer.

## Chosen architecture

The implementation is a per-client hybrid with three cooperating layers.

First, a pure adaptive policy converts the local player's server-owned RTT plus transport jitter and locally observed snapshot-arrival jitter into bounded frame budgets. The same formula runs on every client using that client's own network status; a high-latency player never raises another player's presentation delay.

Second, the client uses that policy for remote snapshot buffering and local reconciliation. Local input remains sampled, predicted, and transmitted in the same render frame. Remote players are shown a few stable frames behind the newest received snapshot. Missing snapshots may be extrapolated for at most two frames before holding the last safe pose. Ordinary local corrections are blended; semantic teleports such as respawn and ring-out remain immediate.

Third, melee contact validation gains bounded server combat rewind. Each input declares the authoritative world tick that the client was presenting when the input was sampled. The server constrains that claim using its own measured RTT/jitter and its retained hitbox history. Only eligible target hitboxes are inspected historically. The authoritative current state receives any resulting hit exactly once.

Full GGPO-style world rollback is deliberately excluded. The current game publishes hits, sound-driving events, knockouts, scores, projectiles, and results immediately. Rewinding the entire world would require event cancellation or delayed finalization and would create a larger correctness risk than the combat problem requires.

## Adaptive policy

The shared pure policy uses `tickMs = 1000 / 60` and these inputs:

- `medianRttMs`: the fresh server-owned gameplay transport median for the local player;
- `transportJitterMs`: median absolute change between the latest five gameplay-path RTT samples;
- `arrivalJitterMs`: the client's EWMA deviation of accepted snapshot arrival intervals;
- `lateSnapshot`: whether the presentation buffer underruns during the current sample window.

Missing or stale RTT is not treated as zero. It uses a conservative neutral budget until a fresh sample arrives.

The target presentation delay is:

    delayFrames = clamp(ceil((tickMs + max(transportJitterMs, arrivalJitterMs * 1.5)) / tickMs), 1, 5)

Stable links therefore keep one frame; unstable links may hold up to five frames. RTT does not directly enlarge this buffer because constant transit time does not cause uneven animation. Jitter and buffer underruns do.

The target rollback window is:

    rollbackFrames = clamp(ceil((medianRttMs / 2 + 2 * transportJitterMs) / tickMs) + delayFrames, 2, 10)

RTT therefore controls how much recent state may be reconciled or inspected, while jitter controls both safety margin and presentation buffering. Ten frames, approximately 167 ms, is the absolute maximum.

Budget increases take effect immediately. A budget decreases by at most one frame after two consecutive fresh network samples and at least two seconds without a buffer underrun. This hysteresis prevents an unstable link from oscillating between visible delay levels.

The policy never delays local input sampling, local prediction, or transmission.

## Gameplay-path jitter truth

Socket.IO already stores individual RTT samples and derives jitter. WebRTC currently publishes a median but overwrites jitter with zero. The WebRTC sampler will publish the same bounded latest-five sample set semantics as Socket.IO so the adaptive policy receives honest server-owned `medianMs` and `jitterMs` in both transport modes.

Switching between WebRTC and fallback clears stale transport samples. Until the new path has a fresh sample, the client uses the conservative neutral policy. A lost Ping probe never changes gameplay mode or blocks snapshots.

## Protocol and input tick

`InputFrame` gains a required non-negative integer `viewTick`. The gameplay protocol version increments because old and new input envelopes are intentionally not wire-compatible in the same running match.

`ArenaScene` exposes the tick selected by `SnapshotTimeline.sample()`. `ArenaSession` attaches that tick to every sampled input. Before the first sampled frame exists, it uses the newest accepted authoritative tick. The client never derives authority from its wall clock.

The server accepts `viewTick` only as a bounded hint. For player `P` at authoritative tick `T`, it computes the allowed rewind span from `P`'s fresh server-owned rollback budget and clamps the claimed tick to `[T - rollbackFrames, T]`. A future tick is clamped to `T`; a tick older than retained history is clamped to the oldest eligible entry. Monotonic input sequence, rate limits, room phase, and transport arbitration remain unchanged.

## Client snapshot buffer

`SnapshotTimeline` becomes tick-oriented rather than relying only on receipt timestamps. It retains sixteen monotonic snapshots, enough for the ten-frame rollback limit plus reorder margin. Duplicate or older ticks are discarded. The render target advances monotonically and never rewinds visually.

For remote players, the timeline interpolates between the two snapshots surrounding `newestTick - delayFrames`. If the next snapshot is missing, it may extrapolate position using authoritative velocity for at most two ticks and only during regulation or sudden death. It then holds. Respawn, knockout-to-respawn transitions, disconnection, and position gaps at or above the existing snap threshold bypass interpolation.

Pulses remain authoritative and use their existing swept server collision. Client pulse presentation may interpolate between buffered snapshots but is never predicted and is not combat-rewound.

## Local prediction and reconciliation

`PredictionBuffer` retains pending inputs through the current rollback window, with an absolute capacity of twelve frames to cover ten replay frames plus acknowledgement/reorder margin. At 60 Hz and eight players, this remains small.

Every authoritative snapshot removes acknowledged sequences, restores the local canonical kinematic/action state, and replays remaining input frames in sequence. The reported rollback count is the number actually replayed, capped by the active window. Continuous movement frames may be compacted only when they carry no quick, heavy transition, or dash edge; action edges are never discarded.

Ordinary correction remains blended. The implementation records correction distance before blending. Corrections at or above 160 px, respawn transitions, and ring-out recovery snap immediately because smoothing those semantic teleports would be misleading. Local hits, clashes, projectiles, scores, and knockouts remain server-only; the client must not predict them.

If a stall exceeds the rollback capacity, the client drops only obsolete continuous-motion history, keeps the newest continuous input and every unacknowledged action edge, and converges to authority. It must not replay an old attack after its authoritative acknowledgement.

## Bounded combat rewind

The server stores a twelve-entry circular `CombatFrameHistory` per active room. Each entry contains the authoritative tick and, for every connected player, position, collision radius, respawn state, protection state, dash-invulnerability state, and connection state. It does not clone the complete match state.

When an attack enters an active slice, its runtime carries the bounded `viewTick` captured from the input that began it. Target eligibility still comes from the current authoritative state. Melee capsule-versus-target-circle contact may use the historical target position for that tick. Protection, respawn, connectivity, and dash invulnerability are conservative: if either current or historical state makes the target ineligible, the rewind cannot create a hit.

Clashes stay on the current authoritative tick so two attackers cannot receive asymmetric historical attack geometry. Pulse spawn, pulse travel, pulse collision, ring-out, score attribution, and result evaluation also stay current and are never rewound.

Each attack's existing `resolvedPlayerIds` and `hitPlayerIds` still guarantee at-most-once resolution. Historical validation produces the same normal authoritative `HIT` event and current-state impulse. No previously published event is withdrawn, renumbered, or replayed.

## Fairness and abuse resistance

The client cannot request an arbitrary rewind. The server limits the claim by fresh RTT/jitter measured on the gameplay path, the absolute ten-frame policy maximum, and the twelve-frame retained history. Stale network telemetry falls back to a smaller neutral window rather than the maximum.

Per-player budgets mean a weak connection does not penalize healthy peers. Combat rewind compensates only for a target pose the attacker plausibly saw; it cannot restore a dead player, bypass current protection, undo a dash, create a projectile hit, or change an already final match.

## Product UI and diagnostics

The player list continues to show only `Ping`. Delay and rollback columns are not restored because they previously consumed arena space and are implementation diagnostics, not a decision the player must make.

The existing scoped `GamePresentationBridge` retains internal getters/subscriptions for `presentationDelayMs` and `rollbackFrames`. Test-only observer records add policy budgets, buffer underruns, extrapolated frames, and correction distance. These values are available to automated acceptance without widening the shipping HUD.

## Deterministic impairment testing

The test harness gains a test-only transport impairment seam at the `ServerPeer` boundary. It can set one direction's fixed transit delay, deterministic jitter sequence, loss pattern, and reorder window for a player. Production construction does not expose or branch on this API.

Vitest covers the policy formula and hysteresis, WebRTC jitter publication, monotonic sixteen-snapshot buffering, bounded extrapolation/hold, rollback capacity and edge preservation, input `viewTick` validation, historical target lookup, conservative eligibility, at-most-once hits, and unchanged current-tick clash/projectile behavior.

Playwright covers active two-player WebRTC and forced Socket.IO fallback at 20, 50, 100, and 150 ms RTT. It uses exact sampled input sequence, authoritative acceptance, presentation telemetry, and correction-distance records rather than DOM timing guesses. A deterministic simultaneous-hit case proves that both legal hits resolve once. Mobile Chromium and WebKit retain their existing trusted touch path and receive a representative impaired-link frame-budget run.

## Acceptance gates

- Local predicted movement or attack presentation starts within one rendered frame at every RTT tier.
- Desktop p95 render frame time stays below 25 ms; mobile p95 stays below 33 ms.
- Four simultaneous ring-out effects keep their existing maximum-frame gate below 50 ms.
- No ordinary reconciliation reaches the 160 px hard-snap threshold.
- At 20/50/100/150 ms RTT, rollback p95 is at most 4/5/8/10 frames respectively.
- An idle player returns to zero pending rollback frames within two accepted snapshots.
- Remote presentation target tick never decreases, even when snapshots reorder.
- A missing snapshot extrapolates at most two frames, then holds.
- A melee input inside its server-owned rewind window can hit the historical eligible target pose exactly once.
- The same input outside the window cannot obtain the historical hit.
- Combat rewind never changes clash timing, projectile results, protection, respawn, score, knockout, or match-result semantics.
- Existing same-host input-to-authoritative and 58 FPS performance gates do not regress.
- `npm run verify`, Chromium WebRTC/fallback/mobile acceptance, and mobile WebKit acceptance all pass.

## Failure handling

When no fresh RTT exists, the policy uses one delay frame and four rollback frames. When snapshot jitter rises or the buffer underruns, delay grows immediately within the five-frame cap. When a client falls back from WebRTC, stale WebRTC samples and budgets are cleared before fallback samples can influence the policy.

Malformed, future, non-integer, or out-of-range `viewTick` never crashes the room. Schema-invalid input is rejected through the existing recoverable protocol error; valid but out-of-window ticks are safely clamped. History is reset at match start, lobby return, result completion, room deletion, and match epoch replacement.

## Non-goals

- No global delay based on the room's worst connection.
- No artificial local keyboard/touch input delay.
- No peer-authoritative combat or client-predicted hit/score/KO.
- No full-world rollback, event cancellation protocol, or delayed event finalization.
- No rollback of projectiles, clashes, ring-outs, scores, results, reconnects, or room lifecycle.
- No new player-list columns for delay or rollback.
- No native/mobile application rewrite and no replacement of Phaser, Socket.IO, or WebRTC.

## Rollout

The feature is delivered in independently testable layers: policy and telemetry truth, client buffer/reconciliation, input tick protocol, combat history/rewind, deterministic impairment tests, then full browser acceptance. Each layer preserves a working authoritative game. Production is rebuilt and restarted only after the full verification and review gates pass; the feature branch and authorized public `main` are then pushed and remote refs verified.
