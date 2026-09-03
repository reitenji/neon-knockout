# Runtime FPS and Latency Optimization ExecPlan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Every production behavior change follows RED-GREEN-REFACTOR.

**Goal:** Preserve 60 FPS gameplay while materially reducing application Ping and browser-main-thread work during active LAN matches.

**Architecture:** Keep the existing authoritative Node.js simulation and Phaser renderer. Socket.IO remains the reliable fallback, but authoritative snapshots become a bounded, latest-wins stream so old frames cannot queue ahead of latency probes. React HUD rendering is decoupled from the 60 Hz game feed, while Phaser keeps receiving every accepted authoritative snapshot. Phaser display objects remain pre-created and their hot path updates transforms or genuinely changed geometry/text only.

**Tech Stack:** TypeScript, Node.js, Socket.IO, Werift/WebRTC DataChannels, Phaser 4, React 19, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md`

## Global Constraints

- Keep the server authoritative and keep simulation, input sampling, snapshot production, and canvas rendering at 60 Hz / 60 FPS.
- Do not replace Phaser, move simulation into C++/WASM, hide measured latency, or redefine the one-column `Ping` metric.
- `match:started`, `match:event`, room lifecycle, results, and errors remain reliable and ordered.
- Only complete `match:snapshot` publications may be coalesced. A delivered snapshot must never be mutated, partially merged, or reordered after a newer delivered epoch/tick.
- Canvas/prediction receives snapshots immediately. HUD throttling must not delay phase, score, roster, winner, or result changes and must always publish the newest pending snapshot.
- Preserve desktop and mobile controls, WebRTC activation/fallback, reconnection, and existing visual semantics.
- Optimize measured hot paths only: no speculative engine swap, broad visual redesign, or unrelated refactor.
- Physical-phone LAN acceptance is reported separately from same-host automated measurements.

## Purpose / Big Picture

The player should see smoother motion and a lower, more stable application Ping in an active match. The key distinction is that server computation is already fast; profiling showed that reliable 60 Hz fallback snapshots and 60 Hz React/Phaser browser work delay network callbacks. After this work, stale snapshots cannot form a long Socket.IO queue, the HUD no longer rerenders for each game tick, and projectile/fighter graphics stop rebuilding unchanged visual data. The player-visible rules and 60 FPS target remain unchanged.

## Progress

- [ ] Task 1: Bound Socket.IO fallback snapshots with latest-wins delivery.
- [ ] Task 2: Decouple the React HUD from the 60 Hz snapshot stream.
- [ ] Task 3: Remove unchanged Phaser graphics and text work from the frame path.
- [ ] Task 4: Re-profile, run complete acceptance, document evidence, and publish.

## Surprises & Discoveries

- Profiling before implementation found `network:probe` handlers themselves take roughly 0-0.1 ms and the Node event-loop p99 is roughly 3.5-4.1 ms; server computation is not the primary delay.
- During active Socket.IO fallback play, five to seven reliable snapshots were observed ahead of a probe acknowledgement, matching roughly 83-117 ms at 60 Hz. With snapshot publication suppressed, the same browser RTT fell substantially.
- A minimal/lobby browser returned Socket.IO probe acknowledgements around 1 ms, while the active Phaser/React match was tens of milliseconds slower. Stopping animation frames collapsed the active-match probe delay, locating the remaining delay in browser scheduling/render work.
- Same-host measurements are diagnostic, not promises for a physical Wi-Fi path. Router/AP contention and phone power scheduling remain external variables.

## Decision Log

- Decision: retain Phaser and optimize its display-object hot path. Rationale: Phaser already supplies WebGL batching, texture reuse, animation timing, and mobile canvas support; replacing it would add risk without addressing the measured queue/scheduling cause.
- Decision: use acknowledgement-paced, latest-wins Socket.IO snapshots instead of merely `volatile.emit`. Rationale: transport writability does not prove that the browser application callback queue is empty; one acknowledged publication in flight gives a deterministic bound.
- Decision: keep WebRTC fast-channel gameplay traffic unchanged unless post-change evidence identifies its own application queue. Rationale: its unreliable, unordered fast channel already drops under backpressure and does not share Socket.IO's reliable head-of-line queue.
- Decision: throttle only the DOM HUD, never the Phaser/prediction subscription. Rationale: combat motion and local response need frame-rate data; text/meters do not need 60 React commits per second.

## Outcomes & Retrospective

Pending implementation and final measurements. Record pre/post browser medians, FPS percentiles, test totals, live service health, publication commit, and any still-pending physical-device checks here.

## Context and Orientation

`src/server/network/socketHandlers.ts` attaches each Socket.IO session and supplies the fallback `emitSnapshot` callback to `GameplayTransportHub`. `src/shared/protocol.ts` is the typed Socket.IO contract. `src/client/network/GameClient.ts` receives fallback publications and hands them to `MatchPublicationSequencer`; this is the earliest safe place to acknowledge that a complete snapshot reached application code.

`src/client/state/gameStore.ts` publishes every accepted match snapshot to two consumers. `src/client/game/phaser/ArenaSession.ts` needs that full-rate stream. `src/client/ui/MatchHud.tsx` currently uses `useSyncExternalStore` directly on the same stream, causing a React render opportunity for every 60 Hz snapshot.

`src/client/game/phaser/PulseView.ts` clears and redraws identical projectile geometry on every apply. `src/client/game/phaser/FighterView.ts` writes immutable names and usually unchanged rounded overload text/facing every frame. `src/client/game/phaser/ArenaView.ts` already has visual-signature dirty checking and is not changed unless new profiling demonstrates a regression there.

`tests/e2e/performance.spec.ts` is the real-browser FPS/input-latency gate. `tests/e2e/webrtcGameplay.spec.ts`, `tests/e2e/networkFallback.spec.ts`, and `tests/e2e/mobile.spec.ts` cover transport and mobile behavior.

## Plan of Work

First, introduce a tiny per-session Socket.IO snapshot pacer whose observable contract is one publication in flight and one newest pending publication. The client acknowledges after synchronously handing the complete publication to the existing transport/sequencer. Reliable match events are not routed through this pacer.

Second, introduce a HUD-only latest-value scheduler capped at one ordinary commit per 50 ms. It flushes immediately when phase, score, player membership, winner, or result reason changes. It owns and clears its timeout on bridge replacement/unmount. Tests prove burst coalescing, latest-value delivery, urgent flush, and cleanup before the hook/component is changed.

Third, dirty-check Phaser presentation data. Projectile geometry is redrawn only when its radius changes; position, heading, and alpha stay transform-only. Fighter labels change only when their actual displayed value changes, and facing rotation is not rewritten for an identical heading. Existing attack/charge redraw guards and animation fidelity remain intact.

Finally, run focused suites, the full verification gate, and repeated real-browser samples. Compare like-for-like active-match baselines rather than presenting a single noisy run. Restart the production build on port 4174, verify listener ownership and localhost/LAN health, then commit and push the finished branch and `main` only after review is clean, as already authorized for this public repository.

## Concrete Steps

### Task 1: Bound Socket.IO fallback snapshots with latest-wins delivery

**Files:**
- Create: `src/server/network/SocketSnapshotPacer.ts`
- Create: `src/server/network/SocketSnapshotPacer.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/server/network/socketHandlers.ts`
- Modify: `src/client/network/GameClient.ts`
- Modify: `src/client/network/GameClient.test.ts`
- Modify as required by the typed callback contract: `tests/integration/socketFlow.test.ts`, `tests/load/eightClients.test.ts`

**Interfaces:**
- `SocketSnapshotPacer.publish(publication): void`
- `SocketSnapshotPacer.dispose(): void`
- `ServerToClientEvents['match:snapshot'](publication, acknowledge): void`, where `acknowledge` is optional only if required to keep test/load clients source-compatible; the production server always supplies it and the production client always calls it.

- [ ] Write tests first proving that the first snapshot sends immediately, a burst while it is in flight retains only the highest/latest publication, acknowledgement releases exactly that publication, stale/double acknowledgements cannot release extra work, and disposal prevents further delivery.
- [ ] Run the focused pacer/client tests and preserve the expected RED caused by the missing pacer/acknowledgement behavior.
- [ ] Implement the smallest per-session pacer and wire only fallback snapshots through it. Clone only the publication that is actually sent; do not clone every superseded pending value.
- [ ] Acknowledge in `GameClient` after passing the complete publication to `acceptSocketSnapshot`, including the no-active-bundle case so the server cannot remain stuck.
- [ ] Dispose the pacer on socket teardown/session replacement and verify no listener/timer survives reconnect.
- [ ] Run focused unit, integration, fallback E2E, and eight-client load tests; commit the task.

### Task 2: Decouple the React HUD from the 60 Hz snapshot stream

**Files:**
- Create: `src/client/ui/HudSnapshotStore.ts`
- Create: `src/client/ui/HudSnapshotStore.test.ts`
- Modify: `src/client/ui/MatchHud.tsx`
- Modify: `src/client/ui/MatchHud.test.tsx`

**Interfaces:**
- `createHudSnapshotStore(bridge, intervalMs = 50)` exposes stable `getSnapshot`, `subscribe`, and `dispose` methods for `useSyncExternalStore`.
- Ordinary combat-only snapshots are latest-wins at 20 Hz maximum.
- Changes to phase, scores, player identity/membership, winner, or result reason notify synchronously.

- [ ] Write fake-timer tests first proving a 60-publication burst creates at most one deferred notification per 50 ms and delivers the newest tick, while each urgent structural change notifies immediately.
- [ ] Prove teardown cancels the pending callback and that a new bridge starts from its own current snapshot.
- [ ] Run focused tests and preserve RED before adding the production store.
- [ ] Replace only `MatchHud`'s direct snapshot subscription with the HUD store. Keep connection subscription immediate and keep Phaser subscribed directly to the bridge.
- [ ] Run MatchHud and Phaser/ArenaSession focused tests; commit the task.

### Task 3: Remove unchanged Phaser graphics and text work from the frame path

**Files:**
- Modify: `src/client/game/phaser/PulseView.test.ts`
- Modify: `src/client/game/phaser/PulseView.ts`
- Modify: `src/client/game/phaser/FighterView.test.ts`
- Modify: `src/client/game/phaser/FighterView.ts`

**Interfaces:**
- `PulseView.apply` redraws geometry only when radius changes, while every call may update position, heading, and lifetime alpha.
- `FighterView.apply` updates displayed name/rounded overload/facing only when that displayed value changes; animation and attack/charge visuals retain their current semantics.

- [ ] Change tests first so an unchanged-radius projectile proves zero additional clear/draw commands, a changed radius proves one redraw, and transform/alpha updates remain immediate.
- [ ] Add tests proving repeated identical fighter data does not call text/facing setters again, then prove a real displayed value or facing change still updates immediately.
- [ ] Run focused tests and preserve RED for both hot-path behaviors.
- [ ] Add local cached display values and the minimum dirty checks needed to pass. Do not cache mutable authoritative objects by reference.
- [ ] Run all Phaser unit/integration tests and commit the task.

### Task 4: Re-profile, run complete acceptance, document evidence, and publish

**Files:**
- Modify: `tests/e2e/performance.spec.ts` only if a reusable benchmark assertion or artifact is needed; do not weaken current gates.
- Modify: `README.md` only if operational/performance behavior needs user-facing documentation.
- Modify: this plan's `Progress`, `Surprises & Discoveries`, and `Outcomes & Retrospective` sections.

- [ ] Run the focused unit/integration suites from Tasks 1-3, then `npm run verify`.
- [ ] Run `tests/e2e/performance.spec.ts` at least three times with one worker and record median FPS, p95 frame time, WebRTC input-to-authoritative latency, and Socket.IO fallback input-to-authoritative latency for every run.
- [ ] Repeat the isolated active-match Socket.IO application-RTT probe used for the baseline. Record samples and compare its median against the pre-change same-host active-render baseline; do not compare it with ICMP or physical-phone Wi-Fi Ping.
- [ ] Run focused Chromium WebRTC/fallback acceptance and mobile WebKit smoke coverage.
- [ ] Generate a task review and final whole-branch review; fix every load-bearing finding and rerun affected tests.
- [ ] Build production, restart `com.reitenji.neon-relay.lan`, prove the new process owns TCP 4174, and verify `/health` through localhost and the advertised LAN URL.
- [ ] Commit the evidence, push the feature branch and authorized public `main`, and verify remote refs. Leave physical phone/AP comparison explicitly pending unless it is actually observed.

## Validation and Acceptance

Automated correctness gates:

1. Pacer unit tests deterministically prove at most one in-flight and one latest pending fallback snapshot.
2. HUD fake-timer tests prove a maximum ordinary notification rate of 20 Hz, immediate structural changes, newest-value delivery, and cleanup.
3. Phaser view tests prove unchanged projectile geometry and text/facing values do not redraw/rewrite, while changed values still render.
4. `npm run verify` passes without weakened tests.
5. WebRTC, forced Socket.IO fallback, reconnect/rematch behavior, and mobile WebKit smoke tests pass.

Performance gates:

1. Existing browser gate remains at median FPS >= 58 and p95 frame time < 25 ms.
2. Compare three post-change runs with the captured pre-change range; report all runs and their aggregate instead of selecting the best run.
3. Active-render Socket.IO application RTT must materially improve from its same-host baseline (roughly 45-80 ms depending on one- versus two-render harness) and must no longer track five-to-seven queued snapshot intervals. If it does not, do not claim success: profile the remaining queue before publication.
4. WebRTC and fallback input-to-authoritative latency must not regress materially; use the existing real-input performance spec rather than synthetic method timing.
5. Physical LAN Ping remains an honest separate observation because Wi-Fi/AP scheduling is outside the same-host gate.

## Idempotence and Recovery

All new schedulers are per-session/per-component and have explicit `dispose` behavior, so repeated session establishment, rematch, reconnect, and React Strict Mode mount/unmount are safe. If an E2E run leaves a server process, stop only the exact PID/listener created by that run. Do not reset the worktree or remove unrelated user files. If the launchd restart fails, inspect current job/listener state before retrying; the existing production build can be relaunched without data migration.

## Artifacts and Notes

Pre-change evidence to retain in the final outcome:

- Real-input browser gate: median frame time about 16.7 ms / median FPS about 59.9; individual WebRTC and fallback latency runs vary.
- Isolated browser Socket.IO application RTT: about 68.5 ms median across two active-render clients in one run.
- Snapshot-suppression comparison: about 81 ms median normally versus about 31 ms with snapshots suppressed in one paired run.
- Active-render versus stopped-render comparison: about 60 ms versus about 1 ms median in one diagnostic run.
- Server-side probe handler and event-loop evidence show the delay is not a long-running Node computation.

Store large/raw profiling output outside tracked source. Only concise reproducible commands and aggregate results belong in this plan.

## Interfaces and Dependencies

No new runtime dependency is expected. Phaser remains the game/rendering engine, React remains the DOM/HUD layer, Socket.IO remains signalling and fallback transport, and Werift remains server WebRTC. The only protocol extension is the per-snapshot Socket.IO acknowledgement callback. The acknowledgement carries no client time, duration, or gameplay data; it is flow control only.

