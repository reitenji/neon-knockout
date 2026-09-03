# Runtime FPS and Latency Optimization ExecPlan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Every production behavior change follows RED-GREEN-REFACTOR.

**Goal:** Preserve 60 FPS gameplay while materially reducing application Ping and browser-main-thread work during active LAN matches.

**Architecture:** Keep the existing authoritative Node.js simulation and Phaser renderer. Socket.IO remains the reliable fallback, but authoritative snapshots become a bounded, latest-wins stream so old frames cannot queue. React HUD rendering is decoupled from the 60 Hz game feed, while Phaser keeps receiving every accepted authoritative snapshot. Ping is sampled on the transport that actually carries gameplay: WebRTC's fast DataChannel uses nonce echoes and Socket.IO fallback uses a lightweight nonce acknowledgement on the same active connection, kept separate from full snapshot acceptance. Phaser display objects remain pre-created and their hot path updates transforms or genuinely changed geometry/text only.

**Tech Stack:** TypeScript, Node.js, Socket.IO, Werift/WebRTC DataChannels, Phaser 4, React 19, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md`

## Global Constraints

- Keep the server authoritative and keep simulation, input sampling, snapshot production, and canvas rendering at 60 Hz / 60 FPS.
- Do not replace Phaser, move simulation into C++/WASM, or cosmetically lower latency. The one-column `Ping` metric remains a server-timed round-trip measurement, but it must use the active gameplay data path instead of a separate control-channel proxy.
- `match:started`, `match:event`, room lifecycle, results, and errors remain reliable and ordered.
- Only complete `match:snapshot` publications may be coalesced. A delivered snapshot must never be mutated, partially merged, or reordered after a newer delivered epoch/tick.
- Canvas/prediction receives snapshots immediately. HUD throttling must not delay phase, score, roster, winner, or result changes and must always publish the newest pending snapshot.
- Preserve desktop and mobile controls, WebRTC activation/fallback, reconnection, and existing visual semantics.
- Optimize measured hot paths only: no speculative engine swap, broad visual redesign, or unrelated refactor.
- Physical-phone LAN acceptance is reported separately from same-host automated measurements.

## Purpose / Big Picture

The player should see smoother motion and a lower, more stable application Ping in an active match. The key distinction is that server computation is already fast; profiling showed that reliable 60 Hz fallback snapshots and 60 Hz React/Phaser browser work delay network callbacks. After this work, stale snapshots cannot form a long Socket.IO queue, the HUD no longer rerenders for each game tick, and projectile/fighter graphics stop rebuilding unchanged visual data. The player-visible rules and 60 FPS target remain unchanged.

## Progress

- [x] Task 1: Bound Socket.IO fallback snapshots with latest-wins delivery.
- [x] Task 2: Decouple the React HUD from the 60 Hz snapshot stream.
- [x] Task 3: Remove unchanged Phaser graphics and text work from the frame path.
- [x] Task 4: Re-profile Tasks 1-3 and isolate the remaining RTT discrepancy.
- [x] Task 5: Measure Ping on the exact active gameplay transport.
- [x] Task 6: Remove the remaining measured arena/frame allocation hot paths.
- [ ] Task 7: Run complete acceptance, review, restart, and publish.

## Surprises & Discoveries

- Profiling before implementation found `network:probe` handlers themselves take roughly 0-0.1 ms and the Node event-loop p99 is roughly 3.5-4.1 ms; server computation is not the primary delay.
- During active Socket.IO fallback play, five to seven reliable snapshots were observed ahead of a probe acknowledgement, matching roughly 83-117 ms at 60 Hz. With snapshot publication suppressed, the same browser RTT fell substantially.
- A minimal/lobby browser returned Socket.IO probe acknowledgements around 1 ms, while the active Phaser/React match was tens of milliseconds slower. Stopping animation frames collapsed the active-match probe delay, locating the remaining delay in browser scheduling/render work.
- Same-host measurements are diagnostic, not promises for a physical Wi-Fi path. Router/AP contention and phone power scheduling remain external variables.
- 2026-09-03 post-change verification: the focused Task 1-3 suite passed 73/73 tests and `npm run verify` passed lint, both TypeScript projects, 596 unit tests, the 1-test eight-client load suite, and production build. The client bundle emitted Vite's >500 kB chunk warning; it did not fail the build.
- 2026-09-03 browser performance run 1 passed: 180 frame samples, 16.70 ms median frame time, 59.88 median FPS, and 17.50 ms p95 frame time. Real-input medians were 17.00 ms WebRTC (p95 18.90, n=12) and 16.00 ms forced Socket.IO fallback (p95 17.60, n=12).
- 2026-09-03 browser performance run 2 failed before latency/frame metrics: after the active eight-player match started, the measured client remained `websocket` instead of negotiating `webrtc` within the test's 10,000 ms allowance. One immediate controller rerun at unchanged `a6f509c` passed (59.88 FPS, 17.60 ms p95 frame; WebRTC 14.00/18.80 ms median/p95; fallback 12.70/13.90 ms); its console evidence was supplied without a retained raw-log artifact. One further serial run passed (59.88 FPS, 17.60 ms p95 frame; WebRTC 15.30/18.30 ms; fallback 14.30/19.40 ms), producing three successful samples total while retaining the failed activation run.
- 2026-09-03 isolated active-render Socket.IO probe used two active 1280x720 fallback-render Chromium contexts and a process-local server `Socket.prototype.emit` wrapper around `network:probe` acknowledgements. It collected 20 samples: 20.06 ms min, 75.96 ms median, 188.74 ms p95, 353.88 ms max. This does not materially improve the retained 68.5 ms same-host active-render baseline, so the performance gate failed. Focused Chromium transport/mobile acceptance and mobile WebKit smoke were not run after this load-bearing failure.
- 2026-09-03 strict post-`REGULATION` queue audit corrected that mixed diagnostic: after resetting counters only once two active fallback canvases and active input were confirmed, 12/12 probe windows had at most one snapshot ahead (10 had zero, 2 had one) and RTT ranged from 0.34-2.05 ms. The pacer therefore solved the reliable snapshot queue; the remaining high displayed WebRTC value comes from its separate reliable heartbeat rather than the fast channel carrying inputs/snapshots.
- Full fallback snapshot acknowledgements later reported 95-101 ms despite exact input-to-authoritative acceptance remaining 2-18 ms. The value was measuring full browser snapshot decode/application scheduling rather than connection RTT, so fallback Ping moved to a one-outstanding lightweight nonce on the same Socket.IO connection. A focused integration test deliberately delays snapshot acknowledgement by 250 ms and proves that the lightweight Ping sample remains independent.
- The original fallback sampler could consume its first probe in the lobby and wait almost one second before producing an in-match sample. Restarting it at each session's `MATCH_STARTED` publication now samples both the host and every guest immediately while leaving an active WebRTC sampler stopped.
- The authoritative scheduler used callback-relative `setInterval` plus an extra `setImmediate` for every match publication. A monotonic recursive deadline now skips timer-level runaway catch-up, passes real elapsed time to the simulation, and dispatches match publications in the same tick after flushing any deferred same-room state.
- A bounded eight-player simulation diagnostic measured authoritative `applyInput -> advance` computation at 0.019 ms p50, 0.053 ms p95, and 0.944 ms maximum. Physics/combat computation therefore does not explain a 50-100 ms stall.
- Remote interpolation retains its stable 16 ms floor but now caps adaptive presentation delay at 24 ms instead of 40 ms, removing up to 16 ms of intentional remote visual latency without changing local prediction or authority.
- Final same-host gameplay-path Ping acceptance reported WebRTC 1-2 ms initially and 1 ms settled; forced WebSocket fallback reported 3 ms initially and 0 ms current / 1 ms median settled. Browser background throttling is disabled for this two-page diagnostic, and these values make no physical-LAN claim.
- The final three 60-sample eight-player runs all passed at 59.88 median FPS and 18.1-18.3 ms p95 frame time. WebRTC median/p95 input acceptance was 13.8/30.0, 3.9/21.5, and 18.5/34.1 ms; fallback was 12.5/27.6, 3.3/20.9, and 17.2/32.9 ms. A preceding run failed only because its test inferred dash success from rightward displacement after the fighter had reached the arena edge; the corrected gate observes the exact Space edge, WebRTC ingress, and authoritative dash cooldown.
- Four simultaneous hit-driven ring-outs produced four same-tick knockouts with 18.6 ms maximum correlated frame time, 18.7 ms global maximum, 18.4 ms global p95, and 59.88 median FPS.

## Decision Log

- Decision: retain Phaser and optimize its display-object hot path. Rationale: Phaser already supplies WebGL batching, texture reuse, animation timing, and mobile canvas support; replacing it would add risk without addressing the measured queue/scheduling cause.
- Decision: use acknowledgement-paced, latest-wins Socket.IO snapshots instead of merely `volatile.emit`. Rationale: transport writability does not prove that the browser application callback queue is empty; one acknowledged publication in flight gives a deterministic bound.
- Decision: keep WebRTC fast-channel gameplay traffic unchanged unless post-change evidence identifies its own application queue. Rationale: its unreliable, unordered fast channel already drops under backpressure and does not share Socket.IO's reliable head-of-line queue.
- Decision: throttle only the DOM HUD, never the Phaser/prediction subscription. Rationale: combat motion and local response need frame-rate data; text/meters do not need 60 React commits per second.
- Decision: preserve Ping as server-owned RTT but sample it on the gameplay transport. Rationale: the existing WebRTC heartbeat measures the reliable control channel rather than the unordered fast channel used by inputs and snapshots, while full fallback snapshot acknowledgements include browser decoding/application work that inflated a same-host network number to 95-101 ms. WebRTC therefore uses a generation-bound fast-channel nonce and fallback uses one tiny nonce/ack on the same Socket.IO connection; neither uses client clocks or a second connection.
- Decision: retain the reliable WebRTC heartbeat only for liveness/fallback. Fast-channel probe loss or backpressure produces no sample and cannot by itself eject a player; the reliable heartbeat remains the transport health authority.

## Outcomes & Retrospective

Tasks 1-7 are complete. The fallback queue is bounded, Ping is server-timed on each active gameplay transport, the reliable WebRTC heartbeat owns only liveness, authoritative scheduling is deadline-anchored, remote presentation buffering is capped at 24 ms, and measured Phaser hot paths stay inside one-frame budgets. Independent whole-branch review, production restart, and remote publication are complete; physical-device observation remains a distinct acceptance step.

Commands and results:

- `npx vitest run src/server/network/SocketSnapshotPacer.test.ts src/client/network/GameClient.test.ts src/client/ui/HudSnapshotStore.test.ts src/client/ui/MatchHud.test.tsx src/client/game/phaser/PulseView.test.ts src/client/game/phaser/FighterView.test.ts tests/integration/socketFlow.test.ts tests/load/eightClients.test.ts --maxWorkers=1` — 8 files, 73 tests passed.
- `npm run verify` — lint passed; both TypeScript checks passed; 61 files/596 tests passed; eight-client load 1/1 passed; production build passed.
- `npx playwright test tests/e2e/performance.spec.ts --grep 'holds one LAN viewport frame budget while eight authoritative players fight' --project=chromium --workers=1` (serial run 1) — passed. n=180, 16.70 ms median frame / 59.88 FPS median / 17.50 ms p95 frame. WebRTC input-to-authoritative n=12: 17.00 ms median / 18.90 ms p95. Forced Socket.IO fallback n=12: 16.00 ms median / 17.60 ms p95.
- Same command (serial run 2) — failed at `tests/e2e/performance.spec.ts:496`: expected transport `webrtc`, received `websocket` after 10,000 ms. One immediate controller rerun at unchanged `a6f509c` then passed 1/1 in 14.0 s: 59.88 median FPS, 17.60 ms p95 frame, WebRTC 14.00/18.80 ms median/p95, and fallback 12.70/13.90 ms. This controller-supplied console evidence has no retained raw-log artifact.
- Same command (serial run 3, resumed evidence) — passed. n=180, 16.70 ms median frame / 59.88 median FPS / 17.60 ms p95 frame. WebRTC input-to-authoritative n=12: 15.30 ms median / 18.30 ms p95. Forced Socket.IO fallback n=12: 14.30 ms median / 19.40 ms p95.
- `node --import tsx --input-type=module` active-match harness — started in-process `createGameServer({ host: '127.0.0.1', port: 0, enableTestHarness: true })`, monkeypatched server `Socket.prototype.emit` only for `network:probe` acknowledgement timing, restored the prototype in `finally`, and used two active 1280x720 Chromium fallback contexts. Its 20 same-host application RTT samples were min 20.06 / median 75.96 / p95 188.74 / max 353.88 ms. This does not materially improve the roughly 68.5 ms pre-change active-render baseline; focused Chromium WebRTC/fallback/mobile acceptance and mobile WebKit smoke were stopped and remain unrun.
- Final `npm run verify` after review repair — lint and both TypeScript projects passed; 65 files / 615 Vitest tests passed; the eight-client fallback load gate passed; the production client/server build passed with only the retained Vite chunk-size warning.
- Final eight-player performance runs (60 exact samples per transport) — three of three corrected runs passed. All reported 59.88 median FPS; p95 frame time was 18.3, 18.1, and 18.2 ms. WebRTC median/p95 was 13.8/30.0, 3.9/21.5, and 18.5/34.1 ms; fallback was 12.5/27.6, 3.3/20.9, and 17.2/32.9 ms.
- Final focused Chromium acceptance — `mobile.spec.ts`, `networkFallback.spec.ts`, and `webrtcGameplay.spec.ts` passed 5/5, including WebRTC, forced polling/WebSocket fallback, rematch generation, and one-value Ping HUD behavior. Same-host WebRTC Ping was 1-2 ms initially and 1 ms settled; fallback was 3 ms initially and 0/1 ms current/median settled.
- Final mobile WebKit acceptance — `safariMobile.spec.ts` passed 1/1 with a trusted touch producing one authoritative WebRTC quick attack.
- Final simultaneous ring-out performance — passed with four hits, four same-tick ring-outs, 18.6 ms correlated maximum frame time, 18.7 ms global maximum, and 59.88 median FPS.
- Independent whole-branch review found one important fallback risk: a throwing snapshot subscriber could skip its acknowledgement and leave `SocketSnapshotPacer` permanently in flight. A red regression test reproduced zero acknowledgements, the client now acknowledges in `finally`, 85/85 focused tests passed, and follow-up review reported no findings.
- Publication-candidate Chromium WebRTC/fallback acceptance passed 2/2 after the review repair. Same-host WebRTC Ping was 3-4 ms initially and 4-6 ms settled; forced WebSocket fallback was 14 ms initially and 3 ms settled.
- Production restart replaced PID 15884 with PID 81786 on `*:4174`; both `http://127.0.0.1:4174/health` and `http://192.168.68.52:4174/health` returned `status: ok` from the new process.
- The feature branch and public `main` were pushed together and `git ls-remote` confirmed that both remote references resolve to the same publication history.

Across the final three corrected runs, median-of-run-medians was 13.8 ms for WebRTC and 12.5 ms for fallback; median-of-run-p95 values was 30.0 ms WebRTC and 27.6 ms fallback. Every run passed the <=20 ms median / <40 ms p95 input gate and the >=58 FPS / <25 ms p95 frame gate. Physical phone/AP comparison remains pending and is not inferred from same-host data.

Raw logs are outside the tracked repository at `/tmp/neon-task4-XsgoYO/`: `focused-vitest.log`, `npm-verify.log`, `performance-run-1.log`, `performance-run-2.log`, `performance-run-4.log`, and `active-render-socketio-rtt.log`. The controller's immediate retry has no retained raw-log artifact.

## Context and Orientation

`src/server/network/socketHandlers.ts` attaches each Socket.IO session, owns its lightweight fallback RTT sampler, and supplies the fallback `emitSnapshot` callback to `GameplayTransportHub`. `src/shared/protocol.ts` is the typed Socket.IO contract. `src/client/network/GameClient.ts` immediately echoes fallback probe nonces and hands complete snapshot publications to `MatchPublicationSequencer` before acknowledging their delivery.

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

### Task 5: Measure Ping on the active gameplay path

**Files:**
- Modify: `src/shared/gameplayTransport.ts`, `src/shared/gameplayTransport.test.ts`
- Modify: `src/server/network/gameplayTransport/GameplayTransportHub.ts`, `src/server/network/gameplayTransport/GameplayTransportHub.test.ts`
- Modify: `src/client/network/GameplayTransport.ts`, `src/client/network/GameplayTransport.test.ts`
- Modify: `src/server/network/socketHandlers.ts`, `src/server/network/SocketSnapshotPacer.ts` and focused tests as required
- Create: `src/server/network/SocketRttSampler.ts` and focused tests
- Modify: `src/shared/protocol.ts`, `src/client/network/GameClient.ts`, and affected tests for the lightweight fallback probe

**Interfaces:**
- WebRTC fast messages gain server `ping` and client `ping-ack` variants with a generation-bound nonce.
- The existing reliable heartbeat continues to decide liveness but no longer supplies displayed RTT.
- Socket.IO fallback records a bounded RTT sample from a lightweight matching nonce acknowledgement on the active connection at no more than one sample per second; snapshot pacing remains independent.

- [x] Write protocol, hub, and client tests first for valid fast-channel nonce echo, stale/malformed nonce rejection, latest-five server-timed median, loss without fallback, and reliable-heartbeat liveness without RTT publication.
- [x] Write a fallback test proving a lightweight same-connection nonce remains low even when full snapshot acknowledgement is deliberately delayed, runs no more than once per second, and continues while the match is paused.
- [x] Preserve RED, then implement the smallest discriminated message unions and server-owned timers needed to pass.
- [x] Keep exactly one fallback probe outstanding, clear it on timeout/session disposal, and restart it safely after transport fallback or a Socket.IO upgrade.
- [x] Run focused protocol/client/hub/socket integration tests and commit the task.

### Task 6: Remove remaining measured arena/frame hot paths

**Files:**
- Modify: `src/client/game/phaser/arenaVisualPlan.ts` and tests
- Modify: `src/client/game/phaser/ArenaView.ts` and tests
- Modify: `src/client/game/phaser/ArenaScene.ts` and tests where applicable
- Modify: `src/client/game/phaser/createNeonGame.ts` and its focused test

**Interfaces:**
- Static arena vertex bands are calculated once rather than allocated for every visual model.
- Pre-contraction warning geometry redraw is bounded while its pulse opacity remains frame-smooth; actual contracting geometry still follows authoritative platform progress immediately.
- Per-frame player/projectile membership sets are reused rather than allocated.
- Phaser remains RAF-driven and capped at 60 FPS; delta smoothing is disabled to remove unnecessary high-refresh averaging work.

- [x] Add focused tests first for stable static vertex references, bounded warning redraw with per-frame alpha updates, immediate contraction redraw, and reused frame membership scratch state where observable.
- [x] Preserve RED, implement only the measured allocation/redraw reductions, and keep the visible warning animation semantics.
- [x] Run the complete Phaser unit set and the simultaneous ring-out browser performance scenario; commit the task.

### Task 7: Complete acceptance, review, restart, and publish

- [x] Run the focused Task 5-6 suites and `npm run verify`.
- [x] Run the real-browser FPS/input-latency benchmark three serial times and retain every result, including failures.
- [x] Run WebRTC, forced fallback, desktop/mobile Chromium, and mobile WebKit acceptance plus the simultaneous ring-out performance case.
- [x] Measure the displayed/gameplay-path Ping in both WebRTC and fallback modes; report same-host automation separately from physical Wi-Fi observations.
- [x] Obtain task and whole-branch review, fix load-bearing findings, and rerun affected gates.
- [x] Build production, restart `com.reitenji.neon-relay.lan`, prove the listener and localhost/LAN health, then push the feature branch and authorized public `main` and verify remote refs.

## Validation and Acceptance

Automated correctness gates:

1. Pacer unit tests deterministically prove at most one in-flight and one latest pending fallback snapshot.
2. HUD fake-timer tests prove a maximum ordinary notification rate of 20 Hz, immediate structural changes, newest-value delivery, and cleanup.
3. Phaser view tests prove unchanged projectile geometry and text/facing values do not redraw/rewrite, while changed values still render.
4. `npm run verify` passes without weakened tests.
5. WebRTC, forced Socket.IO fallback, reconnect/rematch behavior, and mobile WebKit smoke tests pass.
6. WebRTC Ping is derived from matching fast-channel nonce RTT; fallback Ping is derived from a matching lightweight nonce RTT on the same Socket.IO gameplay connection. Reliable-heartbeat and full-snapshot application delay cannot populate the displayed metric.
7. Static arena data is reused, warning-only geometry redraw is bounded, and simultaneous ring-out frame time remains inside the browser budget.

Performance gates:

1. Existing browser gate remains at median FPS >= 58 and p95 frame time < 25 ms.
2. Compare three post-change runs with the captured pre-change range; report all runs and their aggregate instead of selecting the best run.
3. Active-render Socket.IO snapshot-ack RTT must no longer track five-to-seven queued snapshot intervals. The strict post-regulation audit must continue to show no more than one snapshot ahead; standalone control-probe RTT is retained only as diagnostic history.
4. WebRTC and fallback input-to-authoritative latency uses 60 exact samples per transport and must keep each same-host run at median <= 20 ms and p95 < 40 ms.
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

No new runtime dependency is expected. Phaser remains the game/rendering engine, React remains the DOM/HUD layer, Socket.IO remains signalling and fallback transport, and Werift remains server WebRTC. Protocol extensions are the lightweight Socket.IO nonce/ack and generation-bound WebRTC fast-channel ping/ack envelopes. Neither carries client time; all displayed RTT remains timed by the authoritative server.
