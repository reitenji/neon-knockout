# Adaptive Rollback Netcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Start implementation tasks with `superpowers:test-driven-development` and finish with `superpowers:verification-before-completion`.

**Goal:** Keep every player's local controls immediate while stabilizing remote motion and authoritative melee contact across per-player gameplay-path RTT and jitter up to the supported 150 ms tier.

**Architecture:** One shared adaptive policy drives a client-side tick buffer and bounded local reconciliation window. Gameplay protocol v2 carries the authoritative tick presented when input was sampled. The server retains twelve ticks of collision/eligibility poses and may rewind only target hitbox validation for melee. The current Node simulation remains authoritative; local input is never deliberately delayed; clashes, projectiles, ring-outs, scores, results, and room lifecycle never rewind.

**Tech Stack:** TypeScript, Node.js, Socket.IO, WebRTC data channels, Phaser 3, React, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-adaptive-rollback-netcode-design.md`

This is a living ExecPlan conforming to `/Users/serkances/.codex/PLANS.md`. Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` as evidence changes.

## Global Constraints

- Work only in `/Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl` on `feature/adaptive-rollback-netcode`.
- Preserve the authoritative 60 Hz Node simulation, WebRTC fast path, Socket.IO fallback, latest-wins snapshot pacing, Phaser renderer, React HUD, and event sequencer.
- `delayFrames` is remote presentation buffering only. Never delay keyboard/touch sampling, local prediction, or transmission.
- Do not implement full-world rollback or rewind clashes, pulses, ring-outs, scores, results, reconnects, or room lifecycle.
- Keep Ping as the only shipping HUD network value. Delay, rollback, underrun, extrapolation, and correction metrics remain internal/test-visible.
- Protocol v2 intentionally replaces v1; do not add a compatibility adapter.
- Add deterministic failing tests before production changes and commit only green task slices.
- Preserve unrelated work. Agents share this worktree and must not revert or overwrite another agent's changes.

## Purpose / Big Picture

A player on 50-150 ms Wi-Fi should still move and begin attacks on the next rendered frame. Remote players should move continuously through short jitter bursts rather than stepping between irregular snapshots. Reconciliation should replay a bounded, measurable input span. A melee strike may test the target pose the attacker plausibly saw, but only inside a server-owned history window and only when both historical and current eligibility allow it.

The result is visible through exact policy/timeline/protocol/combat tests and browser telemetry under deterministic impairment. It must preserve existing combat semantics, same-host latency, and rendering performance.

## Progress

- [x] (2026-09-03) Approved and committed the design specification as `bf663e2`.
- [ ] Implement shared adaptive policy and honest WebRTC jitter.
- [ ] Implement monotonic tick-oriented remote buffering and two-frame extrapolation.
- [ ] Bound local reconciliation, preserve action edges, and expose correction telemetry.
- [ ] Upgrade inputs to protocol v2 with required `viewTick`.
- [ ] Add twelve-tick combat history and conservative melee-only rewind.
- [ ] Add deterministic impairment and RTT-tier browser acceptance.
- [ ] Complete review, verification, LAN restart, public feature/main push, and remote-ref checks.

## Surprises & Discoveries

- Observation: Current client "rollback" is only pending local input replay; there is no server rewind.
  Evidence: `src/client/game/prediction.ts` reconciles pending frames while `src/server/game/simulation.ts` processes the latest accepted input map.
- Observation: WebRTC keeps a real latest-five RTT median but publishes jitter as zero.
  Evidence: `GameplayTransportHub.recordRttSample` sends only median to `RoomManager.setWebRtcMedian`.
- Observation: Whole-state rollback is affordable in raw CPU/memory but unsafe for already published hits, projectile IDs, knockouts, scores, and results.
  Evidence: The approved design limits history to target hitboxes and applies any hit once to current authoritative state.
- Observation: E2E already observes sampled inputs, accepted snapshots, transport mode, and frame timings, but lacks deterministic impairment and correction distance.
  Evidence: Extend `ArenaSession`, `createGameServer`, `tests/e2e/fixtures.ts`, and the `ServerPeer` boundary.

## Decision Log

- Decision: Budgets are per player, never room-global.
  Rationale: A weak link must not delay healthy peers.
  Date/Author: 2026-09-03 / user and implementation team.
- Decision: Delay frames affect only remote presentation; local sampling, prediction, and send remain same-frame.
  Rationale: Responsive controls are the primary requirement.
  Date/Author: 2026-09-03 / user and implementation team.
- Decision: Rewind only conservative melee target hitbox validation.
  Rationale: It improves late-hit fairness without invalidating published world events.
  Date/Author: 2026-09-03 / implementation team, approved by user.
- Decision: Add required `viewTick`, bump gameplay protocol to 2, and provide no v1 shim.
  Rationale: The server needs a bounded authoritative-tick hint and mixed wire formats add needless ambiguity.
  Date/Author: 2026-09-03 / implementation team, approved by user.
- Decision: Keep implementation diagnostics out of the compact product HUD.
  Rationale: The user requested only Ping in the player list.
  Date/Author: 2026-09-03 / user and implementation team.

## Context and Orientation

`src/shared/constants.ts` defines the 60 Hz cadence. `src/shared/model.ts` owns `InputFrame`, match snapshots, and player network status. `src/shared/protocol.ts` validates Socket.IO messages; `src/shared/gameplayTransport.ts` defines versioned WebRTC envelopes.

Client input is sampled in `ArenaInput.ts`, sequenced/predicted/sent by `ArenaSession.ts`, and rendered by `ArenaScene.ts`. `prediction.ts` contains `PredictionBuffer` and `SnapshotTimeline`. `GamePresentationBridge.ts` is the scoped diagnostic surface. `GameplayTransport.ts` uses WebRTC when ready, falls back to Socket.IO, and latches action edges until authoritative acknowledgement.

Server input enters through `matchInputIngress.ts`, is retained/advanced by `roomManager.ts`, and is applied in `simulation.ts`. `combatResolution.ts` owns clashes, melee contact, and pulse contact; `state.ts` owns attack/player runtime. `GameplayTransportHub.ts` owns WebRTC probes and gameplay-path RTT samples.

A _presentation target tick_ is the monotonically nondecreasing authoritative tick used to render remotes. A _buffer underrun_ means the desired interpolation interval lacks a following snapshot. A _hard snap_ is a correction at least 160 px or a semantic teleport. _Historical eligibility_ is stored connection, protection, respawn, and dash-invulnerability state at one retained tick.

## Plan of Work

### Task 1: Adaptive policy and gameplay-path jitter truth

**Files:** Create `src/shared/netcodePolicy.ts` and `.test.ts`; modify `GameplayTransportHub.ts` and `.test.ts`, `socketHandlers.ts`, `roomManager.ts`, and `roomManager.test.ts`.

Define deterministic `AdaptiveNetcodePolicy.update(sample)` and `reset()` returning `{ delayFrames, rollbackFrames }`. Inputs are `medianRttMs`, `transportJitterMs`, `arrivalJitterMs`, `bufferUnderrun`, and explicit `sampledAtMs`. Test the exact approved formulas, neutral `{1,4}` when RTT is missing/stale, immediate increases, at-most-one-frame decreases after two fresh samples and two seconds without underrun, and reset.

Publish WebRTC `medianMs` plus jitter derived as the median absolute consecutive difference of the latest five RTT samples. Rename `setWebRtcMedian` to `setWebRtcNetworkSample(connectionId, medianMs, jitterMs, sampledAtMs)`. Test nonzero jitter, path/generation reset, and that probe loss never changes gameplay transport mode.

**Verify:**

```bash
npm test -- --run src/shared/netcodePolicy.test.ts src/server/network/gameplayTransport/GameplayTransportHub.test.ts src/server/rooms/roomManager.test.ts
git diff --check
```

Commit: `feat: add adaptive netcode policy`.

### Task 2: Tick-oriented remote snapshot presentation

**Files:** Modify `src/client/game/prediction.ts` and `.test.ts`, `ArenaScene.ts`, `ArenaScene.integration.test.ts`, and `GamePresentationBridge.ts`.

Write failing tests proving that `SnapshotTimeline` retains sixteen monotonic snapshots, discards duplicate/older ticks, never decreases its selected target tick, uses the local player's network status and local arrival jitter, and renders around `newestTick - delayFrames`. When the next snapshot is missing during regulation/sudden death, extrapolate authoritative velocity for at most two ticks and then hold. Snap on respawn, knockout recovery, disconnect, and position gaps at least 160 px. Underruns raise budget immediately; stable decreases obey policy hysteresis.

Expose a readonly sample result carrying target tick, delay frames, extrapolated frames, and underrun without widening `MatchSnapshot`. Keep `delayMs()` as `delayFrames * 1000 / GAME.snapshotRate`. Wire the scene to publish internal diagnostics while pulses remain server-authoritative.

**Verify:**

```bash
npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaScene.integration.test.ts
git diff --check
```

Commit: `feat: add adaptive snapshot timeline`.

### Task 3: Bounded local reconciliation and telemetry

**Files:** Modify `src/client/game/prediction.ts` and `.test.ts`, `ArenaSession.ts` and `.test.ts`, and `GamePresentationBridge.ts`.

Define a readonly reconciliation record with authoritative tick, actual replayed frames, pre-blend correction distance, and hard-snap flag. Test an active two-to-ten-frame window, absolute twelve-frame capacity, ordered replay, acknowledgement removal, zero rollback within two accepted snapshots after idle, and preservation of every quick/heavy transition/dash edge under overflow. Compact only obsolete edge-free continuous movement and keep the newest continuous frame.

Apply the current adaptive rollback budget to `PredictionBuffer`. Keep existing smoothing below 160 px; snap at or above 160 px and on respawn/ring-out recovery. Add records only to the scoped bridge and opt-in E2E observer.

**Verify:**

```bash
npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaSession.test.ts src/client/game/phaser/ArenaScene.integration.test.ts
git diff --check
```

Commit: `feat: bound local netcode reconciliation`.

### Task 4: Protocol v2 and required view tick

**Files:** Modify `src/shared/model.ts`, `protocol.ts` and tests, `gameplayTransport.ts` and tests, `ArenaInput.ts`, `ArenaSession.ts` and tests, plus every explicit `InputFrame` fixture under `src` and `tests`.

Add required `viewTick: number` and validate a finite non-negative integer on both transport paths. Increment `GAMEPLAY_PROTOCOL_VERSION` from 1 to 2 and make version-1 envelopes fail. `ArenaSession` obtains the current presentation target tick from `ArenaScene`; before a target is sampled it uses the newest accepted authoritative tick. Keyboard and touch still predict and send in the sampled frame.

Update all typed fixtures explicitly; do not make the field optional or silently default it in schema parsing. Test negative, fractional, malformed, old-version, future-valid integer, and first-snapshot cases.

**Verify:**

```bash
npm test -- --run src/shared/protocol.test.ts src/shared/gameplayTransport.test.ts src/client/game/phaser/ArenaSession.test.ts src/server/network/matchInputIngress.test.ts src/client/network/GameplayTransport.test.ts
npm run typecheck
git diff --check
```

Commit: `feat: add view tick to gameplay protocol`.

### Task 5: Twelve-tick history and melee-only rewind

**Files:** Create `src/server/game/CombatFrameHistory.ts` and `.test.ts`, `netcodeCompensation.ts` and `.test.ts`; modify `state.ts`, `combat.ts`, `combatResolution.ts` and tests, `simulation.ts` and tests, `roomManager.ts` and tests.

Implement a fixed-capacity circular history capturing tick plus each connected player's immutable position, collision radius, respawn/protection/dash-invulnerability, and connection eligibility. Reset at match start, lobby return, result completion, deletion, and epoch replacement. Test capacity twelve, exact/oldest/newest lookup, immutable capture, and reset.

Store the beginning input's `viewTick` on quick/heavy `AttackRuntime`. Derive the server-owned rollback budget from fresh RTT/jitter; stale data yields four frames. Clamp the claim to `[currentTick - rollbackFrames, currentTick]` and retained history.

Allow only melee target-circle contact to use historical target position. Apply the resulting hit/impulse once to current authoritative state. Both current and historical connection, respawn, protection, and dash-invulnerability must be eligible. Attacker capsule and clashes remain current-tick; pulses never use history.

Test: in-window historical contact hits exactly once; out-of-window cannot extend history; future claim clamps; current or historical protection/dash/respawn/disconnect blocks; two simultaneous legal hits both apply; current clash, projectile, score, knockout, and result semantics remain unchanged.

**Verify:**

```bash
npm test -- --run src/server/game/CombatFrameHistory.test.ts src/server/game/netcodeCompensation.test.ts src/server/game/combatResolution.test.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.test.ts
git diff --check
```

Commit: `feat: add bounded melee combat rewind`.

### Task 6: Deterministic impairment and RTT-tier acceptance

**Files:** Create `TestImpairedServerPeer.ts` and `.test.ts`; modify `ServerPeer.ts`, `createGameServer.ts` and tests, `tests/e2e/fixtures.ts`; create `rollbackLatencyMatrix.spec.ts`; update performance/mobile/WebKit specs.

Add a deterministic test wrapper at the `ServerPeer` boundary with fixed one-way delay, repeating jitter sequence, deterministic loss pattern, and bounded reorder window. Expose controls only through `enableTestHarness`; normal construction must not expose them. Unit tests use injected scheduling, never sleeps.

Extend opt-in E2E telemetry with budgets, target ticks, underruns, extrapolated frames, reconciliation records, sampled input sequences, accepted snapshots, and transport source. Run two-player WebRTC tiers at 20/50/100/150 ms plus representative forced Socket.IO fallback. Assert sequence/tick evidence rather than DOM timing guesses.

Browser gates: same-frame local prediction; desktop p95 below 25 ms; mobile p95 below 33 ms; four-ring-out burst maximum below 50 ms; ordinary corrections below 160 px; rollback p95 no more than 4/5/8/10 frames at 20/50/100/150 ms; idle rollback zero within two accepted snapshots; monotonic target tick under reorder; extrapolation at most two frames then hold; simultaneous legal hits once each; Ping remains the only shipping network field.

**Verify:**

```bash
npm test -- --run src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts src/server/network/createGameServer.test.ts
npx playwright test tests/e2e/rollbackLatencyMatrix.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/performance.spec.ts tests/e2e/mobile.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/safariMobile.spec.ts --project=mobile-webkit --workers=1
git diff --check
```

Commit: `test: add adaptive netcode acceptance matrix`.

### Task 7: Review, full verification, LAN runtime, and publication

Run separate spec-compliance and code-quality reviews. Apply verified findings and rerun affected focused tests. Then run:

```bash
npm run verify
npx playwright test --project=chromium --workers=1
npx playwright test --project=mobile-webkit --workers=1
for run_index in 1 2 3; do npx playwright test tests/e2e/rollbackLatencyMatrix.spec.ts tests/e2e/performance.spec.ts --project=chromium --workers=1 || exit 1; done
git status --short
git diff --check
```

After all gates pass, rebuild/restart the existing LAN service and verify process ownership plus both reachable health endpoints:

```bash
npm run build
launchctl kickstart -k "gui/$(id -u)/com.reitenji.neon-relay.lan"
lsof -nP -iTCP:4174 -sTCP:LISTEN
curl --fail --silent http://127.0.0.1:4174/health
curl --fail --silent http://192.168.68.52:4174/health
```

Push and verify the feature branch:

```bash
git push -u origin feature/adaptive-rollback-netcode
git fetch origin
git rev-parse HEAD
git rev-parse origin/feature/adaptive-rollback-netcode
```

Only after verification, use the clean main checkout. Stop if it has unrelated changes or fast-forward is impossible; never force-push:

```bash
cd /Users/serkances/dev/game
git status --short
git fetch origin
git switch main
git merge --ff-only feature/adaptive-rollback-netcode
git push origin main
git fetch origin
git rev-parse main
git rev-parse origin/main
gh repo view reitenji/neon-relay --json nameWithOwner,visibility,url
```

## Concrete Steps

Run commands from `/Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl` unless a step names the main checkout. A new focused assertion must fail for the intended reason before implementation. Required-field compile failures are acceptable only during Task 4's red phase; restore type safety before committing.

Keep commits task-scoped. Before every commit, run `git diff --check`, inspect `git status --short`, and ensure every changed file belongs to the current task. Keep widespread `viewTick` fixture changes in Task 4.

## Validation and Acceptance

Acceptance requires current-branch evidence for all of the following:

1. Unit tests prove exact policy/hysteresis, honest jitter, protocol v2, bounded replay/edge preservation, monotonic timeline/two-tick extrapolation, and conservative history rules.
2. Combat tests prove no regression to simultaneous hits, clashes, projectiles, protection, ring-out, score, and result finality.
3. Playwright proves active WebRTC and forced fallback behavior with exact input/snapshot evidence at representative RTT tiers.
4. Desktop/mobile/ring-out frame budgets, correction limit, rollback p95, idle recovery, monotonic tick, and extrapolation gates pass.
5. `npm run verify`, full Chromium, and mobile WebKit pass from the final commit.
6. Port 4174 listener ownership and loopback/LAN health checks pass after restart.
7. Feature and public `origin/main` object IDs match the intended verified commit; GitHub reports public visibility.

Manual LAN acceptance remains separate: the user joins from the second PC and phone and judges real router-path Ping and feel. Local automation never claims the physical Wi-Fi path is healthy.

## Idempotence and Recovery

Policy/history tests are deterministic; impairment unit tests use injected scheduling; E2E rooms are isolated. If a task fails, do not reset the worktree. Preserve completed/user work and repair only the current slice. Committed green tasks are recovery boundaries.

Build must succeed before restart. If health fails, inspect listener ownership/logs before any rollback. If push result is uncertain, fetch and compare object IDs before retrying. Never force-push `main`.

## Artifacts and Notes

Record focused pass counts, formula/interface deviations, final verify and browser summaries, three-run metrics, final listener/health evidence, and final local/remote commit IDs here. Keep raw large logs outside the repo and summarize relevant results.

## Interfaces and Dependencies

No new production dependency is expected. Reuse Zod, Phaser, Socket.IO, WebRTC peer abstraction, Vitest fake timers, and Playwright. The policy is deterministic and accepts explicit timestamps. The client owns arrival jitter/underrun; the server owns gameplay-path RTT/jitter and legal rewind. Never trust client latency claims.

`InputFrame.viewTick` is the only wire addition. `AttackRuntime.viewTick` is server-internal. `CombatFrameHistory` exposes immutable collision/eligibility poses, not mutable player references. Diagnostics stay in `GamePresentationBridge` and the opt-in observer.

## Outcomes & Retrospective

At completion, record what shipped, measured RTT/rendering results, adjusted gates and rationale, final service/remote state, and the remaining manual second-device check. If reduced or abandoned, state which user-visible outcome remains unmet and why.

Plan revision note (2026-09-03): Initial plan created from the approved design, source audit, rollback-state cost probe, and existing acceptance seams.
