# Adaptive Rollback Netcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep every player's local controls immediate while making remote motion and authoritative melee contact stable, fair, and measurable across per-player gameplay-path RTT and jitter up to the supported 150 ms tier.

**Architecture:** Add one shared adaptive policy that turns RTT and jitter into per-client `delayFrames` and `rollbackFrames`, use that budget for a tick-oriented remote snapshot buffer and bounded local reconciliation, carry the client-visible authoritative tick in protocol v2 input, and validate melee target contact against a conservative twelve-tick server hitbox history. The Node.js server remains authoritative, local input is never intentionally delayed, and only melee target position may be inspected historically.

**Tech Stack:** TypeScript, Node.js, Socket.IO, WebRTC data channels, Phaser 3, React, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-adaptive-rollback-netcode-design.md`

This ExecPlan is a living document. It must remain conformant with `/Users/serkances/.codex/PLANS.md`. Any worker who changes code must also update `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, `Concrete Steps`, and the revision note at the bottom so a novice can restart from this file alone.

## Global Constraints

- Work only in `/Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl` on branch `feature/adaptive-rollback-netcode`.
- Preserve the authoritative 60 Hz Node.js simulation, WebRTC fast path, Socket.IO fallback, Phaser renderer, React HUD, and existing room and result flow.
- Do not add artificial keyboard, touch, or transmission delay. `delayFrames` means only the remote snapshot presentation buffer.
- Do not implement full-world rollback. Do not rewind clashes, pulses, projectiles, ring-outs, scores, results, reconnects, or room lifecycle.
- Keep Ping as the only shipping network number shown in the player list and HUD. Delay and rollback remain internal telemetry only.
- Protocol version 2 is intentionally incompatible with version 1. Do not add a compatibility shim.
- Use deterministic tests before implementation changes. A task is not done until its focused tests are green.
- Preserve unrelated user changes. If another worker touched a file unexpectedly, inspect the diff and integrate surgically instead of reverting.

## Purpose / Big Picture

After this change, a player on ordinary LAN or healthy Wi-Fi still sees local movement and attack startup within the next rendered frame, even if another player is on a noisier 50-150 ms link. Remote players no longer jerk between uneven snapshots because the client intentionally renders a few authoritative ticks behind the newest accepted snapshot and adapts that offset when jitter rises. When melee timing is late but still plausible, the server may validate the hit against the target pose that the attacker was actually seeing, without reopening or rewinding already published knockouts, pulse outcomes, or match results.

The result is visible in two ways. First, unit and integration tests prove the formulas, timeline behavior, protocol validation, bounded replay, and conservative combat rewind. Second, browser tests under deterministic impairment show that local controls stay immediate, remote motion stays monotonic, rollback stays bounded at each RTT tier, and the existing frame-time and ring-out performance limits do not regress.

## Progress

- [x] (2026-09-03 11:05 +03:00) Approved the hybrid design and committed the design specification as `bf663e2`.
- [x] (2026-09-03 11:32 +03:00) Rewrote the outline into a task-by-task ExecPlan with explicit interfaces, verification commands, publication gates, and recovery notes.
- [ ] Implement Task 1 and commit the adaptive policy and honest WebRTC jitter publication.
- [ ] Implement Task 2 and commit the monotonic sixteen-snapshot remote presentation timeline.
- [ ] Implement Task 3 and commit bounded local reconciliation with correction telemetry.
- [ ] Implement Task 4 and commit gameplay protocol v2 with required `viewTick`.
- [ ] Implement Task 5 and commit twelve-frame combat history with conservative melee-only rewind.
- [ ] Implement Task 6 and commit the deterministic impairment harness and RTT-tier browser acceptance.
- [ ] Run code review and full verification, restart the LAN service, push the feature branch, fast-forward the public `main`, and verify remote refs.

## Surprises & Discoveries

- Observation: The existing client number called rollback is only the count of pending local inputs replayed after a snapshot. No server history is rewound today.
  Evidence: `src/client/game/prediction.ts` replays pending local inputs, while `src/server/game/simulation.ts` consumes only the latest accepted input map.

- Observation: WebRTC currently reports a fresh median RTT but forces jitter to zero, so the client cannot adapt honestly on that path.
  Evidence: `GameplayTransportHub.recordRttSample` computes from the latest five samples, then `socketHandlers.ts` currently forwards only the median to `roomManager.setWebRtcMedian`.

- Observation: Full match-state rollback is computationally cheap enough to be tempting, but it would invalidate current event semantics because hits, projectile IDs, ring-outs, scores, and results are published immediately.
  Evidence: The approved design therefore stores only historical target hitbox state and applies the hit exactly once to the present authoritative state.

- Observation: The repository already has good acceptance seams for this feature.
  Evidence: `GamePresentationBridge` already publishes presentation delay and rollback, `ArenaSession` already reports accepted snapshots to the E2E observer, and `ServerPeer` is already the narrow boundary where deterministic transport impairment can be injected for tests.

## Decision Log

- Decision: Use per-player adaptive budgets rather than a room-global budget.
  Rationale: A weak Wi-Fi path must not add latency to healthy peers.
  Date/Author: 2026-09-03 / user and implementation team.

- Decision: Interpret `delayFrames` only as remote presentation buffering and not as local input delay.
  Rationale: The user explicitly prioritized immediate local controls.
  Date/Author: 2026-09-03 / user and implementation team.

- Decision: Add only bounded combat rewind for melee target position, not GGPO-style world rollback.
  Rationale: This solves the late-hit fairness problem without revoking already published semantic events.
  Date/Author: 2026-09-03 / implementation team, approved by user.

- Decision: Add required `viewTick` to gameplay input and bump the wire version to 2 with no backwards compatibility path.
  Rationale: The authoritative server needs a bounded, declared presentation tick to know what pose the attacker could have seen.
  Date/Author: 2026-09-03 / implementation team, approved by user.

- Decision: Keep delay, rollback, underrun, extrapolation, and correction telemetry internal and test-visible rather than player-visible.
  Rationale: The in-game player list is space-constrained and the user only wants Ping shown.
  Date/Author: 2026-09-03 / user and implementation team.

## Outcomes & Retrospective

No implementation outcome exists yet. The current success criterion is that each task lands as a green, independently verifiable slice with the plan updated after every commit. The main lesson from design is that the risky part is not CPU cost but semantic correctness: any approach that rewinds already published events would make the game harder to trust than the current latency issues.

## Context and Orientation

`src/shared/constants.ts` defines the 60 Hz simulation cadence and the snapshot cadence. In this repository one simulation frame is one 60 Hz tick, which is about 16.67 ms. `src/shared/model.ts` defines `InputFrame`, `MatchPlayer`, `MatchSnapshot`, and `PlayerNetworkStatus`. `src/shared/protocol.ts` validates Socket.IO payloads with Zod, and `src/shared/gameplayTransport.ts` defines the versioned WebRTC envelopes. These are the only shared wire-format files that need protocol changes.

On the client, `src/client/game/phaser/ArenaInput.ts` samples keyboard and touch state. `src/client/game/phaser/ArenaSession.ts` turns the sampled controls into monotonic `InputFrame` values, predicts the local player immediately, and sends the same frame through `GameplayTransport`. `src/client/game/prediction.ts` currently contains both `PredictionBuffer` and `SnapshotTimeline`; it predicts the local player by replaying queued inputs and smooths remote players by interpolation over receipt timestamps. `src/client/game/phaser/ArenaScene.ts` owns the timeline, applies incoming authoritative snapshots, and renders player and pulse presentation. `src/client/game/GamePresentationBridge.ts` is the scoped bridge for internal telemetry and the opt-in E2E observer.

On the server, `src/server/network/matchInputIngress.ts` validates and forwards both Socket.IO and WebRTC input. `src/server/rooms/roomManager.ts` stores the latest accepted input per player, stores per-player network status, advances each room, and emits snapshots. `src/server/game/simulation.ts` is the authoritative match step. It applies current inputs, movement, actions, projectiles, combat, ring-out, respawn, and result progression. `src/server/game/combat.ts` creates attack runtimes. `src/server/game/combatResolution.ts` resolves clashes, melee hits, and pulse hits. `src/server/game/state.ts` defines mutable runtime state including `AttackRuntime`. `src/server/network/gameplayTransport/GameplayTransportHub.ts` owns gameplay-path probes and WebRTC RTT samples. `src/server/network/gameplayTransport/ServerPeer.ts` is the abstraction boundary for the test impairment seam.

A _presentation target tick_ is the authoritative tick the client chooses to render after applying its delay budget. A _buffer underrun_ means the client wants two surrounding authoritative snapshots for interpolation and does not have the newer one yet. A _hard snap_ means either a semantic teleport such as respawn or ring-out recovery, or a position correction of at least 160 pixels that should not be smoothed. A _historical eligibility record_ is the per-player collision and protection state stored in the new combat history for one retained tick.

## Plan of Work

The work proceeds in seven tasks because each task produces a usable, testable slice. The first task adds the adaptive policy and fixes WebRTC jitter truth so every later budget is based on honest data. The second task moves remote presentation from timestamp-only smoothing to a tick-oriented monotonic buffer. The third task makes local reconciliation bounded and observable. The fourth task upgrades the protocol so each input carries the authoritative tick the player was looking at. The fifth task adds server-side combat history and uses it only for melee target validation. The sixth task adds deterministic transport impairment and browser acceptance. The seventh task performs review, full verification, service restart, and GitHub publication.

Every task follows the same red-green loop. Start by adding a failing focused test that names the behavior. Run only that focused test or focused small set and confirm the failure is caused by the missing feature, not by an unrelated error. Implement the smallest production change that makes the test pass. Rerun the focused test, then run any neighboring test file affected by the same interface. Before committing, run `git diff --check` and `git status --short` so the slice stays surgical. Update this plan before each commit.

### Task 1: Shared Adaptive Policy And Gameplay-Path Jitter Truth

**Files**

- Create `src/shared/netcodePolicy.ts`.
- Create `src/shared/netcodePolicy.test.ts`.
- Modify `src/server/network/gameplayTransport/GameplayTransportHub.ts`.
- Modify `src/server/network/gameplayTransport/GameplayTransportHub.test.ts`.
- Modify `src/server/network/socketHandlers.ts`.
- Modify `src/server/rooms/roomManager.ts`.
- Modify `src/server/rooms/roomManager.test.ts`.

**Interfaces**

At the end of this task, `src/shared/netcodePolicy.ts` must export:

    export type AdaptiveNetcodeSample = Readonly<{
      medianRttMs: number | null;
      transportJitterMs: number | null;
      arrivalJitterMs: number;
      bufferUnderrun: boolean;
      sampledAtMs: number;
    }>;

    export type AdaptiveNetcodeBudget = Readonly<{
      delayFrames: number;
      rollbackFrames: number;
    }>;

    export class AdaptiveNetcodePolicy {
      update(sample: AdaptiveNetcodeSample): AdaptiveNetcodeBudget;
      reset(): AdaptiveNetcodeBudget;
    }

At the end of this task, `roomManager.ts` must expose:

    setWebRtcNetworkSample(connectionId: string, medianMs: number, jitterMs: number, sampledAtMs: number): void
    clearWebRtcNetworkSample(connectionId: string): void

The existing `setWebRtcMedian` entry point must be removed and all callers updated in the same commit.

- [ ] Step 1: Write the failing policy tests in `src/shared/netcodePolicy.test.ts`.

  Add tests for the neutral stale budget `{ delayFrames: 1, rollbackFrames: 4 }`, the exact approved formulas, immediate increases when jitter or underrun spikes, one-frame-at-a-time decreases after two fresh samples and two seconds without underrun, and `reset()` returning the neutral budget.

- [ ] Step 2: Run the focused policy test and confirm red.

  Run from `/Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl`:

      npm test -- --run src/shared/netcodePolicy.test.ts

  Expected red signal: missing module or failing assertions around budget values and hysteresis.

- [ ] Step 3: Implement the smallest deterministic policy in `src/shared/netcodePolicy.ts`.

  Use the exact formulas from the spec. Treat missing or stale RTT as neutral. Store only the minimum internal state needed for hysteresis: last emitted budget, last fresh sample time, and a counter for consecutive stable fresh samples. Do not read browser or Node globals inside the policy. The caller passes time explicitly with `sampledAtMs`.

- [ ] Step 4: Add failing WebRTC jitter-truth tests in `GameplayTransportHub.test.ts` and room-manager tests in `roomManager.test.ts`.

  Cover at least these cases: varying latest-five RTT samples produce nonzero median absolute consecutive-difference jitter, switching generations clears stale samples, and no lost probe causes transport fallback or room crash.

- [ ] Step 5: Run the focused transport and room tests and confirm red.

  Run:

      npm test -- --run src/server/network/gameplayTransport/GameplayTransportHub.test.ts src/server/rooms/roomManager.test.ts

  Expected red signal: old method names or wrong jitter values.

- [ ] Step 6: Implement the transport publication changes.

  In `GameplayTransportHub.ts`, keep the latest-five RTT sample semantics and compute `jitterMs` as the median of absolute differences between consecutive samples in that bounded window. In `socketHandlers.ts`, forward both `medianMs` and `jitterMs` to the room manager. In `roomManager.ts`, store both values for the relevant player and clear them whenever a generation switch or transport reset invalidates the old sample set. Do not let probe loss trigger fallback; fallback logic remains whatever it was before this task.

- [ ] Step 7: Rerun the focused tests and commit the green slice.

  Run:

      npm test -- --run src/shared/netcodePolicy.test.ts src/server/network/gameplayTransport/GameplayTransportHub.test.ts src/server/rooms/roomManager.test.ts
      git diff --check
      git status --short
      git add src/shared/netcodePolicy.ts src/shared/netcodePolicy.test.ts src/server/network/gameplayTransport/GameplayTransportHub.ts src/server/network/gameplayTransport/GameplayTransportHub.test.ts src/server/network/socketHandlers.ts src/server/rooms/roomManager.ts src/server/rooms/roomManager.test.ts
      git commit -m "feat: add adaptive netcode policy"

### Task 2: Tick-Oriented Remote Snapshot Presentation

**Files**

- Modify `src/client/game/prediction.ts`.
- Modify `src/client/game/prediction.test.ts`.
- Modify `src/client/game/phaser/ArenaScene.ts`.
- Modify `src/client/game/phaser/ArenaScene.integration.test.ts`.
- Modify `src/client/game/GamePresentationBridge.ts`.

**Interfaces**

At the end of this task, `prediction.ts` must export:

    export type TimelineNetworkSample = Readonly<{
      medianRttMs: number | null;
      transportJitterMs: number | null;
      arrivalJitterMs: number;
      bufferUnderrun: boolean;
      sampledAtMs: number;
    }>;

    export type TimelineSample = Readonly<{
      frame: InterpolationFrame | null;
      targetTick: number | null;
      delayFrames: number;
      extrapolatedFrames: number;
      bufferUnderrun: boolean;
    }>;

`SnapshotTimeline` must grow a method that accepts the local player's network sample before the next render sample:

    updateNetwork(sample: TimelineNetworkSample): void

and a render-sampling method that returns the richer result:

    sample(nowMs: number): TimelineSample

`GamePresentationBridge.ts` must continue to support `publishPresentationDelay(delayMs: number)` and must gain optional internal-only publication helpers for underrun and extrapolation used by tests, not by the shipping HUD.

- [ ] Step 1: Write failing tests in `src/client/game/prediction.test.ts`.

  Add cases proving that the timeline retains sixteen snapshots, ignores duplicate or older ticks, never decreases the selected target tick, derives delay from the local player's network status plus arrival jitter, interpolates around `newestTick - delayFrames`, extrapolates velocity for at most two ticks during `REGULATION` or `SUDDEN_DEATH`, then holds, and snaps for hard-snap situations instead of interpolating.

- [ ] Step 2: Run the focused prediction test and confirm red.

  Run:

      npm test -- --run src/client/game/prediction.test.ts

  Expected red signal: missing `TimelineSample` fields or old timestamp-based behavior.

- [ ] Step 3: Implement the timeline changes in `prediction.ts`.

  Keep the existing local correction logic untouched for now. Replace the current receipt-time-only remote sampling logic with a tick-oriented structure capped at sixteen snapshots. Maintain a monotonic chosen `targetTick`; if a newer out-of-order snapshot arrives after the target moved past it, keep the target monotonic. Compute `delayMs()` from the chosen `delayFrames` so current bridge callers still work. Extrapolate only remote player and pulse presentation, never local authority, and stop after two ticks.

- [ ] Step 4: Add failing scene integration tests in `ArenaScene.integration.test.ts`.

  Cover that `ArenaScene` publishes the derived presentation delay, forwards the local player's latest network sample to the timeline, and preserves existing pulse authority and snap behavior in live rendering integration.

- [ ] Step 5: Run the focused client tests and confirm red.

  Run:

      npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaScene.integration.test.ts

  Expected red signal: old `sample()` shape or missing bridge publications.

- [ ] Step 6: Wire `ArenaScene.ts` and `GamePresentationBridge.ts`.

  In `ArenaScene.ts`, before sampling the timeline for the next render, construct the `TimelineNetworkSample` from the local player's authoritative `snapshot.network` entry plus locally observed arrival jitter and current underrun state. Publish the delay in milliseconds through the existing bridge method and internal-only diagnostics through optional bridge callbacks or observer hooks. Do not widen `MatchSnapshot` for this task.

- [ ] Step 7: Rerun the focused tests and commit the green slice.

  Run:

      npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaScene.integration.test.ts
      git diff --check
      git status --short
      git add src/client/game/prediction.ts src/client/game/prediction.test.ts src/client/game/phaser/ArenaScene.ts src/client/game/phaser/ArenaScene.integration.test.ts src/client/game/GamePresentationBridge.ts
      git commit -m "feat: add adaptive snapshot timeline"

### Task 3: Bounded Local Reconciliation And Correction Telemetry

**Files**

- Modify `src/client/game/prediction.ts`.
- Modify `src/client/game/prediction.test.ts`.
- Modify `src/client/game/phaser/ArenaSession.ts`.
- Modify `src/client/game/phaser/ArenaSession.test.ts`.
- Modify `src/client/game/GamePresentationBridge.ts`.

**Interfaces**

At the end of this task, `prediction.ts` must export:

    export type ReconciliationResult = Readonly<{
      authoritativeTick: number;
      rollbackFrames: number;
      correctionDistancePx: number;
      hardSnap: boolean;
    }>;

`PredictionBuffer` must support:

    setRollbackWindow(frames: number): void
    rollbackFrames(): number

and the reconciliation path used by `ArenaSession` must make `ReconciliationResult` observable through an internal callback or return value so tests can assert it.

- [ ] Step 1: Write failing reconciliation tests in `prediction.test.ts` and `ArenaSession.test.ts`.

  Add cases for a configurable active rollback window between two and ten frames, absolute stored pending-input capacity of twelve, sequence-ordered replay after acknowledgement, compaction dropping only obsolete movement-only history, retention of every unacknowledged `quick`, `heavy`, and `dash` edge during overflow, ordinary sub-160-pixel smoothing, hard-snap on 160-plus-pixel correction, hard-snap on respawn, and idle rollback returning to zero within two accepted snapshots.

- [ ] Step 2: Run the focused reconciliation tests and confirm red.

  Run:

      npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaSession.test.ts

  Expected red signal: pending input queue too large, missing active window, or missing telemetry.

- [ ] Step 3: Implement bounded replay and telemetry.

  In `PredictionBuffer`, retain an absolute maximum of twelve pending frames. When overflow happens, drop only the oldest continuous movement frames that have no `quick`, `heavy`, or `dash` edge, while preserving the newest continuous frame and every action edge. On authoritative reconciliation, remove acknowledged inputs, restore canonical local runtime, replay the remaining queue in order, and report the number of frames actually replayed plus the correction distance before smoothing. Keep the current smoothing for ordinary corrections and snap immediately for semantic teleports and hard-snap distance.

- [ ] Step 4: Connect `ArenaSession.ts` to the active rollback budget from the timeline policy.

  The session must receive the currently chosen rollback budget from client presentation state, set that on `PredictionBuffer`, publish `publishRollbackFrames` as the current replay count or `null` when no local player exists, and expose `ReconciliationResult` only to the scoped bridge or test observer. Do not add new shipping UI in this task.

- [ ] Step 5: Rerun the focused tests and commit the green slice.

  Run:

      npm test -- --run src/client/game/prediction.test.ts src/client/game/phaser/ArenaSession.test.ts src/client/game/phaser/ArenaScene.integration.test.ts
      git diff --check
      git status --short
      git add src/client/game/prediction.ts src/client/game/prediction.test.ts src/client/game/phaser/ArenaSession.ts src/client/game/phaser/ArenaSession.test.ts src/client/game/GamePresentationBridge.ts
      git commit -m "feat: bound local netcode reconciliation"

### Task 4: Gameplay Protocol V2 And Required View Tick

**Files**

- Modify `src/shared/model.ts`.
- Modify `src/shared/protocol.ts`.
- Modify `src/shared/protocol.test.ts`.
- Modify `src/shared/gameplayTransport.ts`.
- Modify `src/shared/gameplayTransport.test.ts`.
- Modify `src/client/game/phaser/ArenaInput.ts`.
- Modify `src/client/game/phaser/ArenaSession.ts`.
- Modify `src/client/game/phaser/ArenaSession.test.ts`.
- Modify every typed test fixture under `src/` and `tests/` that constructs `InputFrame`.

**Interfaces**

At the end of this task, `InputFrame` in `src/shared/model.ts` must be:

    export type InputFrame = Readonly<{
      seq: number;
      viewTick: number;
      moveX: number;
      moveY: number;
      aimX: number;
      aimY: number;
      quick: boolean;
      heavy: boolean;
      dash: boolean;
    }>;

`GAMEPLAY_PROTOCOL_VERSION` in `src/shared/gameplayTransport.ts` must change from `1` to `2`, and both Socket.IO and WebRTC validation must require `viewTick` to be a finite non-negative integer.

`ArenaSession` must gain a constructor dependency or setter that lets it read the current presentation tick selected by `ArenaScene`. The chosen API must remain explicit in code. A novice should be able to search for the provider in `ArenaScene.ts`.

- [ ] Step 1: Add the failing protocol tests.

  In `src/shared/protocol.test.ts` and `src/shared/gameplayTransport.test.ts`, add cases for missing `viewTick`, negative `viewTick`, fractional `viewTick`, malformed string `viewTick`, old protocol version 1, and a valid future integer that must parse successfully before later server-side clamping. In `ArenaSession.test.ts`, add the first-snapshot case where there is no sampled presentation tick yet and the session must fall back to the newest accepted authoritative tick.

- [ ] Step 2: Run the focused protocol tests and confirm red.

  Run:

      npm test -- --run src/shared/protocol.test.ts src/shared/gameplayTransport.test.ts src/client/game/phaser/ArenaSession.test.ts src/server/network/matchInputIngress.test.ts src/client/network/GameplayTransport.test.ts

  Expected red signal: schema validation or fixtures failing because `viewTick` is missing or the version is still 1.

- [ ] Step 3: Implement the wire-format upgrade.

  Add `viewTick` to `InputFrame`, update `createEmptyInput()` in `state.ts`, update all schema validators, bump the protocol version to 2, and explicitly update every fixture instead of adding optional defaults inside validation. Future integer `viewTick` values remain valid at the schema layer because server clamping belongs to Task 5.

- [ ] Step 4: Connect `ArenaScene` and `ArenaSession`.

  Make `ArenaScene` provide the current presentation target tick to the session. Before the first sampled presentation tick exists, use the newest accepted authoritative tick from snapshots. Keep keyboard and touch paths identical and still send the input in the frame in which it was sampled.

- [ ] Step 5: Rerun the focused tests, then typecheck and commit the green slice.

  Run:

      npm test -- --run src/shared/protocol.test.ts src/shared/gameplayTransport.test.ts src/client/game/phaser/ArenaSession.test.ts src/server/network/matchInputIngress.test.ts src/client/network/GameplayTransport.test.ts
      npm run typecheck
      git diff --check
      git status --short
      git add src/shared/model.ts src/shared/protocol.ts src/shared/protocol.test.ts src/shared/gameplayTransport.ts src/shared/gameplayTransport.test.ts src/client/game/phaser/ArenaInput.ts src/client/game/phaser/ArenaSession.ts src/client/game/phaser/ArenaSession.test.ts src tests
      git commit -m "feat: add view tick to gameplay protocol"

### Task 5: Twelve-Frame Combat History And Melee-Only Rewind

**Files**

- Create `src/server/game/CombatFrameHistory.ts`.
- Create `src/server/game/CombatFrameHistory.test.ts`.
- Create `src/server/game/netcodeCompensation.ts`.
- Create `src/server/game/netcodeCompensation.test.ts`.
- Modify `src/server/game/state.ts`.
- Modify `src/server/game/combat.ts`.
- Modify `src/server/game/combatResolution.ts`.
- Modify `src/server/game/combatResolution.test.ts`.
- Modify `src/server/game/simulation.ts`.
- Modify `src/server/game/simulation.test.ts`.
- Modify `src/server/rooms/roomManager.ts`.
- Modify `src/server/rooms/roomManager.test.ts`.

**Interfaces**

At the end of this task, `src/server/game/CombatFrameHistory.ts` must export:

    export type HistoricalPlayerFrame = Readonly<{
      playerId: string;
      position: Vec2;
      collisionRadius: number;
      connected: boolean;
      respawning: boolean;
      protected: boolean;
      dashInvulnerable: boolean;
    }>;

    export type CombatFrame = Readonly<{
      tick: number;
      players: Readonly<Record<string, HistoricalPlayerFrame>>;
    }>;

    export class CombatFrameHistory {
      capture(state: MatchState): void;
      clear(): void;
      latestTick(): number | null;
      oldestTick(): number | null;
      get(tick: number): CombatFrame | null;
    }

At the end of this task, `AttackRuntime` in `src/server/game/state.ts` must gain:

    viewTick: number

At the end of this task, `src/server/game/netcodeCompensation.ts` must export:

    export function clampClaimedViewTick(options: Readonly<{
      currentTick: number;
      claimedViewTick: number;
      medianRttMs: number | null;
      jitterMs: number | null;
      historyOldestTick: number | null;
    }>): number

- [ ] Step 1: Write failing unit tests for `CombatFrameHistory` and `clampClaimedViewTick`.

  Cover capacity twelve, immutable stored frames, exact lookup, oldest and newest lookup after wraparound, stale-neutral four-frame clamp, and future-claim clamp to current tick.

- [ ] Step 2: Run the focused new tests and confirm red.

  Run:

      npm test -- --run src/server/game/CombatFrameHistory.test.ts src/server/game/netcodeCompensation.test.ts

  Expected red signal: missing modules or failing clamp behavior.

- [ ] Step 3: Implement history capture and tick clamping.

  `CombatFrameHistory.capture(state)` should snapshot only the data needed for melee target eligibility and collision. Use a fixed twelve-entry circular buffer. `clampClaimedViewTick` must derive the legal rollback span from fresh `medianRttMs` and `jitterMs` using the same spec formula as the shared policy, fall back to four frames when stale, then clamp into `[currentTick - rollbackFrames, currentTick]` and finally into the retained-history window.

- [ ] Step 4: Add failing combat-resolution and simulation tests.

  Add cases for in-window historical contact hitting exactly once, out-of-window claim failing to extend history, current or historical protection blocking, current or historical dash invulnerability blocking, respawn or disconnect blocking, future claim clamping, simultaneous legal hits both landing once, and unchanged clash, pulse, knockout, score, and result semantics.

- [ ] Step 5: Run the focused combat tests and confirm red.

  Run:

      npm test -- --run src/server/game/combatResolution.test.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.test.ts

  Expected red signal: missing history, missing `viewTick`, or current-only contact logic.

- [ ] Step 6: Implement conservative melee-only rewind.

  In `combat.ts`, bind the `viewTick` from the input that starts the attack. In `roomManager.ts`, own a `CombatFrameHistory` per active room, clear it on match start, lobby return, result completion, room deletion, and any match-epoch replacement, and capture one frame per authoritative tick. In `combatResolution.ts`, keep attacker geometry and clashes on the current authoritative tick, but allow the melee target-circle contact check to use the target's historical position if the attack's bounded tick points to a retained frame. Even if the historical position overlaps, reject the hit if either current or historical state says the target is disconnected, respawning, protected, or dash-invulnerable. Apply the resulting hit exactly once to the current authoritative state. Do not route pulses through history.

- [ ] Step 7: Rerun the focused tests and commit the green slice.

  Run:

      npm test -- --run src/server/game/CombatFrameHistory.test.ts src/server/game/netcodeCompensation.test.ts src/server/game/combatResolution.test.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.test.ts
      git diff --check
      git status --short
      git add src/server/game/CombatFrameHistory.ts src/server/game/CombatFrameHistory.test.ts src/server/game/netcodeCompensation.ts src/server/game/netcodeCompensation.test.ts src/server/game/state.ts src/server/game/combat.ts src/server/game/combatResolution.ts src/server/game/combatResolution.test.ts src/server/game/simulation.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.ts src/server/rooms/roomManager.test.ts
      git commit -m "feat: add bounded melee combat rewind"

### Task 6: Deterministic Impairment Harness And RTT-Tier Acceptance

**Files**

- Create `src/server/network/gameplayTransport/TestImpairedServerPeer.ts`.
- Create `src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts`.
- Modify `src/server/network/gameplayTransport/ServerPeer.ts`.
- Modify `src/server/network/createGameServer.ts`.
- Modify `src/server/network/createGameServer.test.ts`.
- Modify `tests/e2e/fixtures.ts`.
- Create `tests/e2e/rollbackLatencyMatrix.spec.ts`.
- Modify `tests/e2e/performance.spec.ts`.
- Modify `tests/e2e/mobile.spec.ts`.
- Modify `tests/e2e/safariMobile.spec.ts`.

**Interfaces**

At the end of this task, `ServerPeer.ts` must expose a test-only impairment wrapper interface that production code never calls directly. The concrete wrapper lives in `TestImpairedServerPeer.ts` and accepts a delegate `ServerPeer` plus deterministic impairment options:

    export type TransportImpairment = Readonly<{
      oneWayDelayMs: number;
      jitterSequenceMs: readonly number[];
      dropEveryNthPacket: number | null;
      reorderWindow: number;
    }>

`createGameServer.ts` must accept this only through the existing test harness options path. Normal production construction must not gain a public UI or network API for changing impairment.

The E2E observer payload assembled in `tests/e2e/fixtures.ts` must include enough data to assert: chosen Ping, chosen delay frames, rollback frames, correction distances, target ticks, extrapolated frames, authoritative snapshot acceptance, and transport source. Delay and rollback do not return to the shipping HUD.

- [ ] Step 1: Write failing unit tests for the impairment wrapper.

  Add deterministic fake-timer tests for fixed one-way delay, repeating jitter sequence, deterministic packet drop, and bounded reorder. Avoid any real sleep. The wrapper should preserve closed and backpressured semantics from the delegate peer.

- [ ] Step 2: Run the focused impairment tests and confirm red.

  Run:

      npm test -- --run src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts src/server/network/createGameServer.test.ts

  Expected red signal: missing wrapper or missing test-harness hooks.

- [ ] Step 3: Implement the impairment seam.

  Wrap `sendFast`, `sendReliable`, and inbound listener delivery so tests can delay, jitter, drop, or reorder messages deterministically. Expose the wrapper only when `createGameServer` is launched with the existing test harness path used by Playwright fixtures. Do not alter the default LAN runtime path.

- [ ] Step 4: Add or extend failing browser acceptance tests.

  In `tests/e2e/rollbackLatencyMatrix.spec.ts`, cover two-player WebRTC tiers at 20, 50, 100, and 150 ms RTT plus one representative forced Socket.IO fallback case. Extend `performance.spec.ts`, `mobile.spec.ts`, and `safariMobile.spec.ts` to assert the unchanged desktop and mobile frame-time gates, ring-out burst maximum below 50 ms, rollback p95 thresholds 4, 5, 8, and 10 for the four RTT tiers, idle rollback recovery within two accepted snapshots, target tick monotonicity through reorder, two-frame extrapolation max, simultaneous-hit correctness, and Ping remaining the only shipping network field.

- [ ] Step 5: Run the focused browser and transport tests and confirm red.

  Run:

      npm test -- --run src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts src/server/network/createGameServer.test.ts
      npx playwright test tests/e2e/rollbackLatencyMatrix.spec.ts --project=chromium --workers=1

  Expected red signal: missing fixture telemetry or unmet acceptance assertions.

- [ ] Step 6: Implement fixture telemetry and acceptance behavior.

  Extend only the test observer and fixture collection path with policy budgets, target ticks, buffer underruns, extrapolated frames, reconciliation data, sampled input sequences, authoritative snapshot acceptance, and transport source. Keep the player-facing list and HUD limited to Ping. When asserting Ping in tests, treat Ping as the round-trip gameplay-path number already shown in the product and compare against the observed authoritative transport samples instead of browser wall-clock time.

- [ ] Step 7: Rerun the focused tests and commit the green slice.

  Run:

      npm test -- --run src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts src/server/network/createGameServer.test.ts
      npx playwright test tests/e2e/rollbackLatencyMatrix.spec.ts --project=chromium --workers=1
      npx playwright test tests/e2e/performance.spec.ts tests/e2e/mobile.spec.ts --project=chromium --workers=1
      npx playwright test tests/e2e/safariMobile.spec.ts --project=mobile-webkit --workers=1
      git diff --check
      git status --short
      git add src/server/network/gameplayTransport/ServerPeer.ts src/server/network/gameplayTransport/TestImpairedServerPeer.ts src/server/network/gameplayTransport/TestImpairedServerPeer.test.ts src/server/network/createGameServer.ts src/server/network/createGameServer.test.ts tests/e2e
      git commit -m "test: add adaptive netcode acceptance matrix"

### Task 7: Review, Full Verification, LAN Runtime, And Publication

**Files**

- Modify this ExecPlan with final progress, decisions, outcomes, and evidence.
- Modify only any production or test file required by verified review findings.

- [ ] Step 1: Run a requirement-by-requirement review against the approved spec.

  For each major spec section, point to the implementing code and tests. If a requirement is missing, fix it before moving on. Record any deviation in `Decision Log` and `Artifacts and Notes`.

- [ ] Step 2: Run a separate code-quality review pass.

  Focus on correctness regressions, stale interfaces, accidental compatibility paths, and missing tests. Apply only verified findings and rerun the affected focused tests.

- [ ] Step 3: Run the full repository verification gates from the feature worktree.

  Run:

      npm run verify
      npx playwright test --project=chromium --workers=1
      npx playwright test --project=mobile-webkit --workers=1
      git diff --check
      git status --short

- [ ] Step 4: Run the latency and performance acceptance three times to catch flakiness.

  Run:

      python3 - <<'PY'
      import subprocess
      commands = [
          ["npx", "playwright", "test", "tests/e2e/rollbackLatencyMatrix.spec.ts", "tests/e2e/performance.spec.ts", "--project=chromium", "--workers=1"]
      ]
      for index in range(3):
          print(f"run {index + 1}/3")
          for command in commands:
              subprocess.run(command, check=True)
      PY

- [ ] Step 5: Build and restart the LAN service on port 4174 and verify health.

  Run:

      npm run build
      launchctl kickstart -k "gui/$(id -u)/com.reitenji.neon-relay.lan"
      lsof -nP -iTCP:4174 -sTCP:LISTEN
      curl --fail --silent http://127.0.0.1:4174/health
      curl --fail --silent http://192.168.68.52:4174/health

  Expected green signal: one listener owned by the intended service process and both health endpoints returning JSON with `"status":"ok"`.

- [ ] Step 6: Push and verify the feature branch remote ref.

  Run:

      git push -u origin feature/adaptive-rollback-netcode
      git fetch origin
      git rev-parse HEAD
      git rev-parse origin/feature/adaptive-rollback-netcode

  Expected green signal: local `HEAD` equals `origin/feature/adaptive-rollback-netcode`.

- [ ] Step 7: Fast-forward the public `main` checkout and verify GitHub visibility.

  Run from `/Users/serkances/dev/game`:

      git status --short
      git fetch origin
      git switch main
      git merge --ff-only feature/adaptive-rollback-netcode
      git push origin main
      git fetch origin
      git rev-parse main
      git rev-parse origin/main
      gh repo view reitenji/neon-relay --json nameWithOwner,visibility,url

  Stop instead of forcing anything if the main checkout is dirty or `--ff-only` fails.

## Concrete Steps

All commands in Tasks 1 through 6 run from `/Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl`. Only Task 7 step 7 runs from `/Users/serkances/dev/game`, which is the clean public main checkout authorized for publication. The red phase for any task must be a focused test failure that names the missing behavior. A red phase caused only by broad fixture fallout is acceptable in Task 4 after adding required `viewTick`, but that fallout must be resolved before the commit.

At every stopping point, append the exact command you ran and a one-line outcome to `Artifacts and Notes`. When a command produces large output, do not paste the entire log into this plan. Save it outside the repository, keep only the path plus the short pass or fail summary here, and leave the repository clean except for intended source changes.

If a task requires touching a wide fixture surface, do it in the same task as the interface change that forced it. Do not spread one breaking interface across multiple commits because that leaves the branch in a partially migrated state that a novice cannot safely resume.

## Validation and Acceptance

The implementation is accepted only when all of the following are true in the final branch state:

1. The shared policy tests prove the exact delay and rollback formulas, the neutral fallback, immediate increases, gradual decreases, and reset behavior.
2. WebRTC transport tests prove that server-owned jitter is nonzero when RTT samples vary and that generation resets clear stale samples.
3. Client prediction tests prove sixteen-snapshot retention, monotonic target tick, two-frame maximum extrapolation, hold-after-extrapolation, bounded rollback storage, action-edge preservation, idle rollback recovery, and hard-snap behavior.
4. Protocol tests prove that version 2 requires `viewTick` and that version 1 payloads are rejected.
5. Combat tests prove in-window historical melee contact can land exactly once and that out-of-window, protected, respawning, disconnected, or dash-invulnerable targets still cannot be hit. Clash, pulse, knockout, score, and result semantics must remain unchanged.
6. Browser tests prove local predicted movement and attack start within one rendered frame at 20, 50, 100, and 150 ms impaired RTT, and that rollback p95 stays within 4, 5, 8, and 10 frames respectively.
7. Browser tests prove desktop render p95 stays below 25 ms, mobile render p95 stays below 33 ms, and four simultaneous ring-out effects stay below the existing 50 ms maximum-frame gate.
8. Browser tests prove the player-facing network UI still shows Ping only, while internal observer telemetry exposes the extra metrics needed for assertions.
9. `npm run verify`, full Chromium Playwright, and mobile WebKit Playwright all pass from the final feature commit.
10. The restarted LAN service on port 4174 returns healthy JSON from loopback and `192.168.68.52`, and the feature branch plus `origin/main` both resolve to the intended published commit.

Manual LAN acceptance remains a separate human gate after automation. The user should test from the second PC and phone after the service restart and judge real perceived smoothness. Automated acceptance does not claim a physical router path is healthy.

## Idempotence and Recovery

Tasks 1 through 6 are safe to rerun because their unit and browser tests are deterministic by design. The impairment harness must use fake timers for unit tests so reruns do not depend on ambient wall-clock timing. Browser fixtures should create isolated rooms and tear them down automatically so a failed run does not poison the next one.

If a task fails midway, do not reset the worktree. Inspect `git status --short`, keep any green work, and repair only the active task. The recovery boundary is the last green task commit plus the updated plan state in this file. If the worktree contains unrelated changes that overlap the same file, pause and merge them intentionally rather than reverting.

The service restart is recoverable because `npm run build` updates the built files before `launchctl kickstart -k` reloads the service. If health checks fail, inspect listener ownership and service logs before deciding whether to restart again. Never use destructive Git commands as a recovery shortcut.

Publication is idempotent if remote refs are verified after each push. If a push result is uncertain, fetch and compare commit IDs before retrying. Never force-push the feature branch or `main`.

## Artifacts and Notes

As work progresses, append short evidence bullets here. Keep each bullet to one command and one result. Large logs belong outside the repository.

- Example entry format: `npm test -- --run src/shared/netcodePolicy.test.ts` -> `5 tests passed in 420 ms`.
- Example entry format: `git commit -m "feat: add adaptive netcode policy"` -> `created commit <sha>`.
- Example entry format: `curl --fail --silent http://127.0.0.1:4174/health` -> `{"status":"ok",...}`.

## Interfaces and Dependencies

No new production dependency is expected. Reuse the existing Zod validators, Phaser scene flow, Socket.IO path, WebRTC peer abstraction, Vitest fake timers, and Playwright harness. If an existing helper already computes median or bounded-window samples, reuse it instead of duplicating math.

The shared adaptive policy is the single source of truth for frame-budget math. The client is responsible for local arrival jitter and buffer-underrun observation. The server is responsible for gameplay-path RTT and jitter truth and for clamping `viewTick` to a legal rewind span. The client must never be allowed to claim arbitrary latency or arbitrary rewind depth.

`InputFrame.viewTick` is the only wire-format addition. `AttackRuntime.viewTick`, `CombatFrameHistory`, timeline diagnostics, and reconciliation telemetry are internal implementation details. The shipping player list continues to show only Ping. Test-only observer payloads may contain delay, rollback, correction, and target-tick metrics as long as those values do not leak into the player-facing UI.

## Plan Revision Note

2026-09-03: Replaced the initial outline with a full ExecPlan that names exact files, interfaces, red-green commands, review gates, restart steps, and publication checks so execution can proceed task by task without prior conversation context.
