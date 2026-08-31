# Core Combat Redesign Implementation Plan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be updated whenever work stops, a new fact changes the implementation, or a task finishes. A future contributor must be able to resume from this file and the working tree alone.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Update `Progress` after every stopping point and commit each green task separately.

## Purpose / Big Picture

After this work, two to eight friends on the same local network can play a two-minute browser brawler using only a keyboard. Attacks visibly travel through the same space the server tests for a hit; a partially charged heavy no longer jumps to a full-charge pose; full charge launches one short Neon Pulse; clashes and well-timed dashes create readable counterplay. The existing room creation, join, ready, reconnect, result, and rematch flow remains intact.

The result is visible by running `npm run lan`, opening the printed local address in two isolated browser contexts, creating and joining a room, and playing with `WASD`, the arrow keys, `Shift`, and `Space`. Completion requires the automated unit, integration, load, build, browser, and performance gates plus this real two-browser LAN journey to pass on the same commit.

## Progress

- [x] (2026-08-31 06:10Z) Investigated the live game and traced pointer input, center-sector hits, charge-release snapping, old KO timing, and late contraction to their source files.
- [x] (2026-08-31 06:18Z) Recorded and received user approval for `docs/superpowers/specs/2026-08-31-core-combat-redesign-design.md`.
- [x] (2026-08-31 06:28Z) Mapped client, server, presentation, and acceptance surfaces and wrote this self-contained ExecPlan.
- [x] (2026-08-31 06:49Z) Task 0: repaired Vitest/Playwright suite separation; 39 Vitest files and 200 tests pass, with Playwright specs left to the Playwright runner (`df6fa6a`).
- [ ] Task 1: add shared attack profiles and continuous geometry.
- [ ] Task 2: replace pointer combat with keyboard-only input.
- [ ] Task 3: extend authoritative state, snapshots, and events.
- [ ] Task 4: replace sector hits with sweeps, clashes, and perfect dodge.
- [ ] Task 5: add Neon Pulse and align match pacing.
- [ ] Task 6: make prediction and charge/release animation continuous.
- [ ] Task 7: render shared sweeps, pulses, charge direction, FX, audio, and HUD feedback.
- [ ] Task 8: complete integration, E2E, load, performance, live LAN, review, merge, and public GitHub proof.

## Surprises & Discoveries

- Observation: the current charge-release defect is not a timing mismatch; every attack transition uses zero blend time and the heavy release plan starts from the authored 700 ms pose even when the server accepts release at 180 ms.
  Evidence: `src/client/game/phaser/animationPlan.ts` defines the charge plan at 0/350/700 ms and a full-charge first release keyframe, while `src/client/game/phaser/AnimationDirector.ts` applies zero-transition plans immediately.
- Observation: current hits are mechanically consistent but visually misleading because the server tests a range-and-angle sector from the fighter center instead of the rendered weapon path.
  Evidence: `src/server/game/combat.ts` currently resolves `inAttackArc`, while `src/client/game/phaser/FighterView.ts` draws an unrelated fixed trail polygon.
- Observation: the LAN/session foundation is already useful and should be preserved.
  Evidence: the existing eight-client WebSocket test has passed with at least 250 snapshots per client over ten seconds, and the production server has answered both localhost and private-LAN `/health` probes.
- Observation: the first draft of this plan placed pulse spawn before movement and omitted the countdown no-gameplay gate.
  Evidence: review against the approved nine-step phase order and `src/server/game/simulation.test.ts` showed that pulse origin/movement and countdown behavior would regress; Task 5 now preserves the gate and spawns/advances pulses after movement and separation.
- Observation: the first full baseline test run found that Vitest imports Playwright's two `.spec.ts` files and fails before executing them as Playwright tests.
  Evidence: `npm test -- --maxWorkers=1` produced `2 failed | 39 passed` files and `200 passed` Vitest tests; both failures were “Playwright Test did not expect test() to be called here.” `npx vitest list --maxWorkers=1 --exclude 'tests/e2e/**'` exited zero, proving the missing runner exclusion is the boundary defect.
- Observation: preserving `configDefaults.exclude` while adding the path-scoped `tests/e2e/**` exclusion restores a trustworthy baseline without moving or editing either Playwright spec.
  Evidence: commit `df6fa6a` passed 39 Vitest files / 200 tests, typecheck, targeted ESLint, and an independent spec-and-quality review with no findings.

## Decision Log

- Decision: retain Knockout FFA at 120 seconds or five credited knockouts; defer Neon Crown and Knockout Rounds without adding a mode framework.
  Rationale: the user approved those as later modes and asked to make the current core mechanics good first.
  Date/Author: 2026-08-31, user and Codex.
- Decision: use one keyboard-only scheme: `WASD` movement, arrow-key quick direction, `Shift` plus arrows for steerable heavy charge, `Shift` release to lock/release, and `Space` dash.
  Rationale: it removes mouse-button ambiguity and gives every LAN player the same directional capability.
  Date/Author: 2026-08-31, user and Codex.
- Decision: keep the existing `InputFrame` wire fields and change only their physical input source.
  Rationale: the normalized move/aim/button contract already crosses prediction, Socket.IO, and the authoritative simulation cleanly.
  Date/Author: 2026-08-31, Codex; approved by user.
- Decision: use shared pure attack profiles and swept capsules for both server collision and Phaser trails.
  Rationale: a single geometry definition prevents visible reach and authoritative reach from drifting apart.
  Date/Author: 2026-08-31, Codex; approved by user.
- Decision: make maximum charge create one 900-unit/s, 400 ms Neon Pulse and make the pulse share the originating heavy's target-hit set.
  Rationale: this adds a short ranged decision without another button or duplicate damage on one target.
  Date/Author: 2026-08-31, user and Codex.
- Decision: reward the first avoided contact of a dash with a 550 ms cooldown refund and no other power or damage bonus.
  Rationale: this adds timing mastery without punishing a player or creating snowball stats.
  Date/Author: 2026-08-31, user and Codex.
- Decision: warn at 78 seconds remaining, contract from 75 to 40 seconds remaining, and return control 600 ms after a normal knockout.
  Rationale: the user rejected a 90-second match as too short but wanted more frequent conflict and little downtime.
  Date/Author: 2026-08-31, user and Codex.
- Decision: add a preflight Task 0 that excludes `tests/e2e/**` from Vitest while preserving Vitest's default exclusions.
  Rationale: Playwright files were added after the original Vitest configuration; without this repair, `npm test` and the plan's final `npm run verify` can never be valid green gates.
  Date/Author: 2026-08-31, Codex after reproducible baseline evidence.
- Decision: execute Tasks 1 and 2 sequentially even though their code ownership is independent.
  Rationale: the selected subagent-driven-development workflow forbids simultaneous implementers so each task receives an isolated implementation and review range. This trades some wall-clock parallelism for unambiguous commits and mandatory per-task review.
  Date/Author: 2026-08-31, Codex.

## Outcomes & Retrospective

Implementation started with the test-runner boundary. Task 0 is accepted at `df6fa6a`: Vitest now excludes only `tests/e2e/**` in addition to its defaults, all 39 Vitest files / 200 tests pass, typecheck and targeted ESLint pass, and the isolated review found no specification or quality issues. The remaining implementation starts with shared combat profiles and continuous geometry in Task 1, followed by keyboard-only input in Task 2.

## Context and Orientation

The repository root is `/Users/serkances/dev/game/.worktrees/neon-relay-implementation` on branch `feat/neon-relay-game`; run every command in this plan from that directory unless a step explicitly says otherwise. The public remote is expected to be `git@github.com:reitenji/neon-relay.git`. The approved behavior is documented in `docs/superpowers/specs/2026-08-31-core-combat-redesign-design.md`, but all implementation-critical values and rules are repeated in this plan so it remains self-contained.

The browser UI is React, while the arena is a Phaser scene. `src/client/game/phaser/ArenaInput.ts` samples physical controls into `InputFrame`. `src/client/game/phaser/ArenaSession.ts` sends those frames and feeds `src/client/game/prediction.ts`, which predicts only the local player's immediate motion and pose. `src/client/game/phaser/ArenaScene.ts` reconciles snapshots and owns fighter, effect, audio, and future pulse views. `src/client/ui/MatchHud.tsx` presents match status and controls.

Socket.IO validates incoming frames in `src/server/network/socketHandlers.ts`; `src/server/rooms/roomManager.ts` owns rooms and calls `stepMatch` at 60 Hz; `src/server/game/simulation.ts` owns the tick order. `src/server/game/combat.ts` currently owns attack lifecycle and center-sector hits, `src/server/game/movement.ts` owns movement/dash/separation, and `src/server/game/state.ts` owns mutable authoritative state. A snapshot is the read-only server state periodically broadcast to all clients. Authoritative means that only this server state decides gameplay outcomes even when the local client predicts presentation.

A hurtbox is the circle that represents where a fighter can be hit. A swept capsule is the area covered by moving a thick line segment between the weapon point's previous and current 60 Hz positions; it prevents a fast attack from passing through a target between ticks. A clash is a collision between two active attacks. Perfect dodge is the first real attack or pulse contact avoided during one dash, which refunds part of that dash's cooldown. Neon Pulse is the short projectile created only by a fully charged heavy. Reduced motion is a presentation setting that removes sharp camera/hit-stop motion without changing simulation or input timing.

The test stack is Vitest for pure/unit/integration/load tests and Playwright for real browsers. `createGameServer({ enableTestHarness: true })` exposes an in-process test object only to test code; it is not an HTTP or Socket.IO route and must remain impossible to reach in production.

**Tech stack:** TypeScript 6, Node.js 20+, Socket.IO 4, React 19, Phaser 4, Vitest 4, Playwright 1.62, and Vite 8.

**Working tree:** `/Users/serkances/dev/game/.worktrees/neon-relay-implementation`

**Branch:** `feat/neon-relay-game`

## Fixed decisions and constraints

- The shipping mode remains Knockout FFA: 120 seconds or first to five credited knockouts.
- `WASD` moves, arrow keys attack in eight directions, `Shift` charges/steers heavy, releasing `Shift` locks and releases, and `Space` dashes.
- Mouse input has zero gameplay effect. No controller, touch, alternate preset, mode framework, Crown mode, or Rounds mode is added in this work.
- The wire shape of `InputFrame` stays unchanged.
- The server is the only source of hit, clash, dodge, pulse, knockout, score, and phase truth.
- All target ordering is stable by numeric attack/projectile ID and then lexicographic player ID.
- Tests may extend the existing in-process `testHarness`; no production HTTP or socket test route may be added.
- Focused Vitest commands use `--maxWorkers=1` on this host.
- Generated `.playwright-cli/` and `output/` artifacts are not source and must not be committed.

## Plan of Work

Task 0 first restores trustworthy test-runner separation. The first feature stage then establishes two independent foundations: Task 1 creates the shared profile and geometry library without changing live combat, while Task 2 changes only the physical input adapter and keeps the existing wire frame. Their file ownership does not overlap, but the selected subagent-driven workflow runs them sequentially so each diff receives an isolated review. Each must finish with focused tests and typecheck green before its commit is accepted.

The second stage moves gameplay truth to the new model. Task 3 freezes the state and event interfaces, Task 4 replaces melee sector tests with shared swept shapes plus clash/perfect-dodge rules, and Task 5 adds projectiles and pacing while aligning the full server phase order. These tasks are sequential because every later one consumes the runtime types and deterministic ordering established by the former. `src/server/rooms/roomManager.ts` belongs to Task 5 until that commit is green; Task 8 may extend it only afterward for private test-harness access, so parallel workers cannot collide there.

The third stage makes the new truth feel good. Task 6 fixes local prediction and animation continuity. After the shared snapshot interface is frozen it may overlap with the server-only portion of Task 5, but it must not invent projectile or hit outcomes. Task 7 then renders shared sweep paths, authoritative pulses, charge direction, event effects, audio, and HUD feedback. Task 8 proves the whole product through real inputs, load/performance checks, LAN health, review, and public GitHub state.

## Implementation dependency graph

Task 0 precedes all feature work. Tasks 1 and 2 have separate ownership but run sequentially under the selected workflow. Task 3 waits for Task 1. Task 4 waits for Tasks 1 and 3. Task 5 waits for Task 4. Task 6 waits for Tasks 1–3 and begins after Task 5 in this workflow. Task 7 waits for Tasks 5 and 6. Task 8 waits for all production tasks.

---

## Task 0: Repair Vitest and Playwright suite separation

This preflight task repairs the automated proof boundary without changing gameplay. Vitest's default include pattern accepts `.spec.ts`, so the Playwright files added under `tests/e2e/` are imported by the wrong runner and throw before their real browser environment exists. At the end, Vitest lists and runs only Vitest-owned files, Playwright retains sole ownership of `tests/e2e/`, and the 200-test baseline is green.

**Owner boundary:** `vitest.config.ts` only. Do not rename browser tests or weaken their Playwright coverage.

1. Reproduce the red baseline:

    npx vitest list --maxWorkers=1

Expected: non-zero exit with “Playwright Test did not expect test() to be called here” from both `tests/e2e/knockout.spec.ts` and `tests/e2e/performance.spec.ts`.

1. Confirm the single hypothesis without editing source:

    npx vitest list --maxWorkers=1 --exclude 'tests/e2e/**'

Expected: zero exit and no path under `tests/e2e/` in the listing.

1. In `vitest.config.ts`, import `configDefaults` beside `defineConfig` from `vitest/config`, then set `test.exclude` to `[...configDefaults.exclude, 'tests/e2e/**']`. Preserving `configDefaults.exclude` keeps `node_modules` and `.git` excluded instead of accidentally replacing Vitest's safe defaults.

1. Verify the repair:

    npx vitest list --maxWorkers=1 > /tmp/neon-relay-vitest-list.txt
    test -z "$(rg 'tests/e2e/' /tmp/neon-relay-vitest-list.txt || true)"
    npm test -- --maxWorkers=1
    npm run typecheck
    npx eslint vitest.config.ts

Expected: the path check exits zero, Vitest reports 39 passing test files and 200 passing tests with zero failures, both TypeScript projects pass, and ESLint prints no error.

1. Commit only the runner boundary:

    git add vitest.config.ts
    git commit -m "fix: separate vitest and playwright suites"

---

## Task 1: Add shared attack profiles and continuous combat geometry

This task creates the mathematical source of truth without changing live combat yet. At its end, pure tests demonstrate exact attack timings/reach, continuous 60 Hz collision, epsilon near misses, and eight-direction rotational symmetry, and the rest of the repository still typechecks.

**Owner boundary:** only shared combat profile/geometry files and their tests.

**Files:**

- Create: `src/shared/combat/profiles.ts`
- Create: `src/shared/combat/profiles.test.ts`
- Create: `src/shared/combat/geometry.ts`
- Create: `src/shared/combat/geometry.test.ts`

**Interfaces produced:**

    export type AttackProfileId = 'quick-1' | 'quick-2' | 'quick-3' | 'heavy-melee';
    
    export type AttackProfile = Readonly<{
      id: AttackProfileId;
      attack: AttackKind;
      windupMs: number;
      activeMs: number;
      recoveryMs: number;
      originOffset: Vec2;
      weaponPath: readonly Vec2[];
      thickness: number;
      reach: number;
      overloadGain: number | Readonly<{ minimum: number; maximum: number }>;
      baseImpulse: number | Readonly<{ minimum: number; maximum: number }>;
    }>;
    
    export type HurtCircle = Readonly<{ center: Vec2; radius: number }>;
    export type SweptCapsule = Readonly<{ from: Vec2; to: Vec2; radius: number }>;
    
    export function profileForAttack(kind: AttackKind): AttackProfile;
    export function sampleWeaponPoint(
      origin: Vec2,
      facing: Vec2,
      profile: AttackProfile,
      activeProgress: number
    ): Vec2;
    export function buildAttackCapsule(
      origin: Vec2,
      facing: Vec2,
      profile: AttackProfile,
      previousProgress: number,
      currentProgress: number
    ): SweptCapsule;
    export function capsuleIntersectsCircle(capsule: SweptCapsule, circle: HurtCircle): boolean;
    export function capsulesIntersect(left: SweptCapsule, right: SweptCapsule): boolean;


The four final shared profiles use these exact authored values. `weaponPath` points are local to `originOffset`, and `reach` includes attack thickness:

| Profile | Origin | Weapon path | Thickness | Reach | Timing W/A/R | Overload | Impulse |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `quick-1` | `(22,0)` | `(12,-32) (36,-16) (40,8) (20,32)` | 12 | 75 | 70/60/100 | 8 | 280 |
| `quick-2` | `(22,0)` | `(20,34) (42,14) (38,-14) (14,-34)` | 12 | 76 | 65/65/120 | 10 | 325 |
| `quick-3` | `(22,0)` | `(8,-42) (46,-25) (50,8) (32,40)` | 16 | 89 | 115/70/205 | 16 | 455 |
| `heavy-melee` | `(22,0)` | `(8,-45) (48,-24) (52,0) (48,24) (8,45)` | 20 | 94 | 110/90/320 | 18–32 | 460–760 |

1. Write profile tests that assert every timing/stat and that sampled endpoints stay within the declared reach.
1. Write geometry tests named:
  - `hits when a swept capsule crosses a hurt circle between 60 Hz samples`
  - `does not hit a circle one epsilon outside combined radii`
  - `is rotationally symmetric across eight facings`
  - `detects crossing attack capsules regardless of argument order`
1. Run the red tests:

    npx vitest run src/shared/combat/profiles.test.ts src/shared/combat/geometry.test.ts --maxWorkers=1


Expected: failure because `profiles.ts` and `geometry.ts` do not exist.

1. Implement immutable profiles and the pure geometry functions. Rotate local points by the normalized facing vector; use closest-point-on-segment distance for circle/capsule and segment-to-segment distance for capsule/capsule.
1. Add explicit degenerate-segment handling so a zero-length sweep behaves as a circle instead of producing `NaN`.
1. Re-run the focused tests and expect all profile/geometry tests to pass.
1. Run `npm run typecheck` and expect both TypeScript projects to pass.
1. Commit only the Task 1 files:

    git add src/shared/combat/profiles.ts src/shared/combat/profiles.test.ts src/shared/combat/geometry.ts src/shared/combat/geometry.test.ts
    git commit -m "feat: add shared combat geometry"


---

## Task 2: Replace pointer combat with keyboard-only input sampling

This task makes the browser emit the approved keyboard semantics through the unchanged input wire contract. At its end, focused tests prove every edge/latch/release rule, pointer APIs are absent from gameplay sampling, and an accepted frame still passes the strict protocol schema.

**Owner boundary:** input sampling and its unit tests only. Do not change shared model or server combat here.

**Files:**

- Modify: `src/client/game/phaser/ArenaInput.ts`
- Modify: `src/client/game/phaser/ArenaInput.test.ts`
- Modify: `src/client/game/phaser/ArenaSession.ts`
- Modify: `src/client/game/phaser/ArenaSession.test.ts`
- Modify: `src/shared/protocol.test.ts`

**Input seam:**

    type HeldMovement = Readonly<{
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      dash: boolean;
    }>;
    
    type HeldAttack = Readonly<{
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      shift: boolean;
    }>;
    
    export interface ArenaInputSource {
      movement(): HeldMovement;
      attack(): HeldAttack;
      reset(): void;
    }


`ArenaInput` keeps `lastAttackFacing`, `attackDirectionHeld`, `heavyLatched`, `previousShift`, `previousDash`, `suppressQuickUntilNeutral`, and `suppressHeldUntilRelease`. Its emitted frame rules are exact:

    const attackDirection = resolveAttackDirection(heldAttack);
    const quick = attackDirection !== null &&
      !heldAttack.shift &&
      !state.attackDirectionHeld &&
      !state.suppressQuickUntilNeutral;
    const heavy = heldAttack.shift && (state.heavyLatched || attackDirection !== null);
    const aim = attackDirection ?? state.lastAttackFacing;


1. Replace the mouse-era tests with red tests for cardinal quick, normalized diagonal quick, opposing-key cancellation, no held-key repeat, `Shift`-plus-direction charge, direction steering while held, last-direction retention after arrow release, locked direction on `Shift` release, dash edge, 60 Hz cap, blur/hidden/shutdown suppression, and full release before reacceptance.
1. Add a protocol regression assertion that the unchanged `{seq, moveX, moveY, aimX, aimY, quick, heavy, dash}` payload still parses and that an added mouse field is rejected by the strict schema.
1. Run the red tests:

    npx vitest run src/client/game/phaser/ArenaInput.test.ts src/client/game/phaser/ArenaSession.test.ts src/shared/protocol.test.ts --maxWorkers=1


Expected: keyboard attack tests fail because `ArenaInputSource` still requires pointer methods and arrow keys still contribute to movement.

1. Implement the pure movement and attack-direction resolvers. `WASD` must be the only movement direction source; arrows must be the only attack direction source.
1. Make `createPhaserInputSource` register `W`, `A`, `S`, `D`, all arrows, `Shift`, and `Space`; call Phaser keyboard capture for those keys so arrows and space do not scroll the page while the scene owns focus.
1. Remove `pointerState`, `projectPointer`, `activePointer`, mouse buttons, and camera projection from the gameplay input path.
1. Ensure a heavy latch suppresses quick until all arrow keys return to neutral; releasing `Shift` while an arrow is still held must not create a quick attack.
1. Keep the outgoing `InputFrame` normalized and monotonic. Update `ArenaSession` only as needed if the unused player-position argument is removed.
1. Re-run the focused tests and then `npm run typecheck`.
1. Commit only Task 2 files:

    git add src/client/game/phaser/ArenaInput.ts src/client/game/phaser/ArenaInput.test.ts src/client/game/phaser/ArenaSession.ts src/client/game/phaser/ArenaSession.test.ts src/shared/protocol.test.ts
    git commit -m "feat: add keyboard-only combat input"


---

## Task 3: Extend authoritative combat state, snapshots, and events

This task freezes the data contract required by later server and presentation work. At its end, snapshots deterministically expose attack metadata and pulses, events can represent every new outcome, all neutral fixtures are explicit, and typecheck/lint remain green even though the new mechanics are not resolved yet.

**Owner boundary:** shared wire types, server runtime state, serialization, and compile fixture updates. No new contact behavior yet.

**Files:**

- Modify: `src/shared/model.ts`
- Modify: `src/server/game/state.ts`
- Modify: `src/server/game/simulation.ts`
- Modify: `src/client/game/prediction.ts` for compile-safe neutral metadata only
- Modify: `src/shared/protocol.test.ts`
- Modify fixture builders in:
  - `src/client/game/prediction.test.ts`
  - `src/client/game/phaser/ArenaSession.test.ts`
  - `src/client/game/phaser/ArenaScene.integration.test.ts`
  - `src/client/game/phaser/AnimationDirector.test.ts`
  - `src/client/game/phaser/ImpactFx.test.ts`
  - `src/client/game/phaser/GameAudio.test.ts`
  - `src/client/game/phaser/LocalActionAudioTracker.test.ts`
  - `src/client/state/gameStore.test.ts`
  - `src/client/ui/MatchHud.test.tsx`
  - `src/client/App.test.tsx`
  - `src/client/game/PhaserArena.test.tsx`

**Required public state:**

    export type HitSource = AttackKind | 'NEON_PULSE';
    
    export type MatchAction = Readonly<{
      kind: AttackKind | 'DASH' | 'HITSTUN' | 'RESPAWNING' | null;
      phase: AttackPhase;
      comboStep: 0 | 1 | 2 | 3;
      chargeMs: number;
      charging: boolean;
      attackId: number | null;
      profileId: AttackProfileId | null;
      lockedFacing: Vec2 | null;
      activeProgress: number;
      hitTargetIds: readonly string[];
    }>;
    
    export type MatchPulse = Readonly<{
      projectileId: number;
      ownerPlayerId: string;
      originatingAttackId: number;
      position: Vec2;
      velocity: Vec2;
      radius: number;
      remainingMs: number;
      hitTargetIds: readonly string[];
    }>;
    
    export type MatchSnapshot = Readonly<{
      tick: number;
      phase: MatchPhase;
      remainingMs: number;
      platformProgress: number;
      scores: Readonly<Record<string, number>>;
      players: readonly MatchPlayer[];
      pulses: readonly MatchPulse[];
      winnerPlayerId: string | null;
      resultReason: MatchResultReason | null;
    }>;


Add these concrete event variants to `GameEvent`:

    Readonly<{
      type: 'CLASH';
      playerIds: readonly [string, string];
      attackIds: readonly [number, number];
      impactPosition: Vec2;
      strength: 'QUICK' | 'HEAVY';
    }>;
    Readonly<{
      type: 'PERFECT_DODGE';
      playerId: string;
      attackerId: string;
      attackId: number;
      source: HitSource;
      projectileId: number | null;
      impactPosition: Vec2;
      refundedMs: number;
    }>;
    Readonly<{
      type: 'PULSE_SPAWN';
      projectileId: number;
      ownerPlayerId: string;
      originatingAttackId: number;
      position: Vec2;
    }>;
    Readonly<{
      type: 'PULSE_BREAK';
      projectileId: number;
      breakerPlayerId: string;
      breakerAttackId: number;
      impactPosition: Vec2;
    }>;


Change the existing `HIT.attack` field from `AttackKind` to `HitSource`.

**Required private runtime:**

    export type AttackRuntime = {
      attackId: number;
      kind: AttackKind;
      profileId: AttackProfileId;
      phase: AttackPhase;
      phaseRemainingMs: number;
      phaseElapsedMs: number;
      previousActiveProgress: number;
      lockedFacing: Vec2;
      chargeMs: number;
      hitPlayerIds: Set<string>;
      resolvedPlayerIds: Set<string>;
    };
    
    export type PulseRuntime = {
      projectileId: number;
      ownerPlayerId: string;
      originatingAttackId: number;
      position: Vec2;
      previousPosition: Vec2;
      velocity: Vec2;
      radius: number;
      remainingMs: number;
      hitPlayerIds: Set<string>;
    };


`MutableMatchPlayer` gains `perfectDodgeConsumed`, and `MatchState` gains `nextProjectileId` plus `pulses: Record<number, PulseRuntime>`.

1. Add red serialization tests asserting stable numeric projectile ordering, stable hit-target ordering, locked facing, normalized active progress, and all four new event shapes.
1. Run:

    npx vitest run src/shared/protocol.test.ts src/server/game/simulation.test.ts --maxWorkers=1


Expected: type and assertion failures because snapshots do not contain pulse/action metadata and the event union lacks the new variants.

1. Implement the model/runtime fields with required values rather than optional compatibility fields.
1. Initialize all new runtime fields in `createMatchState`; reset `perfectDodgeConsumed` only when a new dash begins or the player is reset.
1. Serialize `MatchAction` and `MatchPulse` in `snapshotMatch`; sort pulse IDs numerically and every exposed target ID lexicographically. A held pre-release charge serializes as `kind: null`, `phase: 'IDLE'`, `charging: true`, non-zero `chargeMs`, and null attack/profile/locked-facing fields. A committed heavy serializes as `kind: 'HEAVY'`, `charging: false`, preserved release `chargeMs`, and non-null attack/profile/locked-facing fields.
1. Update test builders with explicit neutral defaults (`charging: false`, null IDs/profile/facing, `activeProgress: 0`, empty target IDs, and `pulses: []`). Do not add a legacy snapshot adapter.
1. Run the focused tests, `npm run typecheck`, and `npm run lint`.
1. Commit Task 3:

    git add src/shared/model.ts src/server/game/state.ts src/server/game/simulation.ts src/client/game/prediction.ts src/shared/protocol.test.ts src/client/game/prediction.test.ts src/client/game/phaser/ArenaSession.test.ts src/client/game/phaser/ArenaScene.integration.test.ts src/client/game/phaser/AnimationDirector.test.ts src/client/game/phaser/ImpactFx.test.ts src/client/game/phaser/GameAudio.test.ts src/client/game/phaser/LocalActionAudioTracker.test.ts src/client/state/gameStore.test.ts src/client/ui/MatchHud.test.tsx src/client/App.test.tsx src/client/game/PhaserArena.test.tsx
    git commit -m "feat: expose authoritative combat state"


---

## Task 4: Replace sector hits with shared sweeps, clashes, and perfect dodge

This task makes melee contact trustworthy and contestable. At its end, the server no longer uses center-origin range/angle tests; focused combat tests prove visible sweeps, near misses, multi-target deduplication, all clash priorities, charge interruption, and the once-per-dash refund.

**Owner boundary:** server attack lifecycle, melee interaction resolution, dash refund, and tests. Neon Pulse is Task 5.

**Files:**

- Modify: `src/shared/constants.ts`
- Modify: `src/server/game/combat.ts`
- Create: `src/server/game/combatResolution.ts`
- Create: `src/server/game/combatResolution.test.ts`
- Modify: `src/server/game/combat.test.ts`
- Modify: `src/server/game/movement.ts`
- Modify: `src/server/game/movement.test.ts`
- Modify: `src/server/game/simulation.ts`
- Modify: `src/server/game/simulation.test.ts`

Add final combat constants:

    perfectDodgeRefundMs: 550,
    quickClashRecoil: 90,
    heavyClashRecoil: 150,


The resolution seam is:

export type ActiveAttackShape = Readonly<{
  playerId: string;
  attackId: number;
  kind: AttackKind;
  capsule: SweptCapsule;
}>;

export type ActiveAttackSlice = Readonly<{
  playerId: string;
  attack: AttackRuntime;
  previousProgress: number;
  currentProgress: number;
  enteredActive: boolean;
}>;

export type CombatTimerAdvance = Readonly<{
  activeSlices: readonly ActiveAttackSlice[];
  activated: readonly ActiveAttackSlice[];
}>;

export function advanceCombatTimers(state: MatchState, stepMs: number): CombatTimerAdvance;
export function buildActiveAttackShapes(
  state: MatchState,
  slices: readonly ActiveAttackSlice[]
): readonly ActiveAttackShape[];
export function resolveMeleeInteractions(
  state: MatchState,
  shapes: readonly ActiveAttackShape[]
    ): readonly GameEvent[];


Within `resolveMeleeInteractions`, execute in this order:

1. Sort active shapes by `attackId`, then `playerId`.
2. Resolve intersecting attack pairs before hurt circles.
3. Quick/quick moves both attacks immediately to recovery and applies opposite 90-unit recoil.
4. Heavy/quick moves only the quick to recovery; heavy remains active.
5. Heavy/heavy moves both to recovery and applies opposite 150-unit recoil.
6. Build target hurt circles with radius `GAME.collisionRadius`.
7. For an intersecting dash-invulnerable target, add that target to the attack's private `resolvedPlayerIds`; on the first avoided attack of that dash, subtract exactly 550 ms from cooldown, set `perfectDodgeConsumed`, and emit one event.
8. For a surviving normal hit, update both `resolvedPlayerIds` and `hitPlayerIds`, then apply overload, impulse, hitstun, last-attacker attribution, charge cancellation, stats, and one `HIT` event.

1. Rewrite old range/arc tests as red sweep tests for visible hit, near miss, one target once per attack, and multiple overlapping targets.
1. Add red tests for quick/quick, heavy/quick, heavy/heavy, charge cancellation on confirmed hit, eight locked directions, and exact one-time 550 ms perfect-dodge refund.
1. Add a timer-boundary test proving the terminal portion of an active sweep is resolved even when the same 60 Hz step moves the runtime into recovery.
1. Add a movement test proving `perfectDodgeConsumed` becomes false only when a new legal dash starts, not when a cooldown merely reaches zero.
1. Run:

    npx vitest run src/server/game/combat.test.ts src/server/game/combatResolution.test.ts src/server/game/movement.test.ts src/server/game/simulation.test.ts --maxWorkers=1


Expected: clash/dodge tests fail because the simulation still calls the center-sector `resolveAttackHits` path.

1. Update `beginAttack` to copy `latestInput` aim into immutable `lockedFacing`, attach `profileId`, and zero phase progress.
1. Update lifecycle timing from the shared profile. Return an `ActiveAttackSlice` for every portion of the current step spent in `ACTIVE`, including a terminal slice whose runtime reaches recovery during that step; this avoids losing the last weapon segment at a phase boundary.
1. Implement deterministic clash cancellation and recoil without applying overload or hitstun.
1. Implement swept-capsule hurtbox contacts and perfect-dodge resolution.
1. Remove `AttackTuning.range`, `AttackTuning.arcDeg`, `inAttackArc`, and the obsolete `range`/`arcDeg` combat path once every caller uses shared profiles.
1. Keep existing late-recovery quick buffering; resolve the buffered step's facing only when the buffered attack commits.
1. Run focused tests, `npm run typecheck`, and `npm run lint`.
1. Commit Task 4:

    git add src/shared/constants.ts src/server/game/combat.ts src/server/game/combatResolution.ts src/server/game/combatResolution.test.ts src/server/game/combat.test.ts src/server/game/movement.ts src/server/game/movement.test.ts src/server/game/simulation.ts src/server/game/simulation.test.ts
    git commit -m "feat: resolve shared-shape combat"


---

## Task 5: Add authoritative Neon Pulse and align simulation pacing

This task completes server combat and match tempo. At its end, one fully charged heavy creates one continuously tested pulse, projectile and melee interactions follow the approved order, stale pulses cannot survive their owner/match, KO control returns in 600 ms, and the arena follows the 78/75/40-second schedule without breaking countdown behavior.

**Owner boundary:** projectile lifecycle, projectile interactions, authoritative phase order, KO/contraction timing, cleanup, and server tests.

**Files:**

- Modify: `src/shared/constants.ts`
- Create: `src/server/game/projectiles.ts`
- Create: `src/server/game/projectiles.test.ts`
- Modify: `src/server/game/combat.ts`
- Modify: `src/server/game/combatResolution.ts`
- Modify: `src/server/game/combatResolution.test.ts`
- Modify: `src/server/game/simulation.ts`
- Modify: `src/server/game/simulation.test.ts`
- Modify: `src/server/rooms/roomManager.ts`
- Modify: `src/server/rooms/roomManager.test.ts`
- Modify: `src/client/game/phaser/arenaVisualPlan.ts`
- Modify: `src/client/game/phaser/arenaVisualPlan.test.ts`

Add final pacing/projectile constants and remove the superseded contraction lead/duration values:

    knockoutToControlMs: 600,
    contractionWarningRemainingMs: 78_000,
    contractionStartRemainingMs: 75_000,
    contractionMinimumRemainingMs: 40_000,
    pulseSpeed: 900,
    pulseLifetimeMs: 400,
    pulseRadius: 18,
    pulseOverloadGain: 14,
    pulseBaseImpulse: 340,


**Projectile API:**

    export function spawnNeonPulse(
      state: MatchState,
      owner: MutableMatchPlayer,
      attack: AttackRuntime
    ): Readonly<{ pulse: PulseRuntime; event: GameEvent }> | null;
    
    export function advancePulses(state: MatchState, stepMs: number): void;
    export function removePulse(state: MatchState, projectileId: number): void;
    export function removePulsesOwnedBy(state: MatchState, playerId: string): void;
    export function clearPulses(state: MatchState): void;


Only a heavy with `chargeMs === GAME.heavyMaxChargeMs` spawns a pulse, exactly once when its attack transitions into `ACTIVE`. The pulse starts at the heavy profile's forward-most sampled weapon point, travels along `lockedFacing`, and receives the same `Set<string>` instance as `attack.hitPlayerIds`; this is the required melee/pulse target deduplication.

1. Add red projectile tests for exact spawn threshold, one spawn only, 900 units/s travel, 400 ms cleanup, maximum 360-unit travel, first-target consumption, shared melee/pulse hit set, stable IDs, melee/pulse break, and owner/result/reset cleanup.
1. Replace pacing tests with warning at 78 seconds remaining, contraction start at 75 seconds, minimum at 40 seconds, 600 ms control return, overload reset without score loss, no score for self-fall, and tied regulation entering minimum-arena sudden death.
1. Add an event-order test for `CLASH`, `PULSE_BREAK`, `PERFECT_DODGE`, `HIT`, `KNOCKOUT`, `RESULT` sorted by the approved phase order and stable IDs.
1. Run:

    npx vitest run src/server/game/projectiles.test.ts src/server/game/combatResolution.test.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.test.ts --maxWorkers=1


Expected: projectile modules/constants are absent, KO still uses 700 ms, and contraction still follows the old last-30-seconds formula.

1. Use `CombatTimerAdvance.activated` to retain attacks that enter `ACTIVE` until movement/separation finishes, then spawn each eligible pulse from its owner's post-movement position.
1. Implement continuous pulse travel as a capsule from `previousPosition` to `position`; use it for both fighter contacts and attack/pulse clashes.
1. Extend combat resolution so quick/heavy sweeps destroy intersecting pulses and emit one `PULSE_BREAK`, while a surviving pulse hits the nearest eligible target by travel parameter then stable player ID and is consumed.
1. Treat a pulse crossing a dash-invulnerable hurt circle as an avoided first-target contact: consume the pulse, emit no `HIT`, and route the same once-per-dash perfect-dodge refund with `source: 'NEON_PULSE'` and that projectile ID.
1. Apply pulse hitstun/impulse with `HIT.attack === 'NEON_PULSE'`. Never award a second hit to a target already present in the originating heavy's shared hit set.
1. Rebuild `stepMatch` in this observable order:

const activeAtStart = state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH';
acceptInputs(state, inputs);
const combatStep = advanceCombatTimers(state, stepMs);
advanceMatchClocks(state, stepMs, events);
updateContraction(state);
if (!activeAtStart) return events;
startActions(state, stepMs);
advancePlayers(state, stepMs);
separateActivePlayers(state);
spawnActivatedPulses(state, combatStep.activated, events);
advancePulses(state, stepMs);
const shapes = buildActiveAttackShapes(state, combatStep.activeSlices);
    events.push(...resolveClashesAndPulseBreaks(state, shapes));
    events.push(...resolveSurvivingContacts(state, shapes));
    const knockoutEvents = resolveBoundaries(state);
    events.push(...knockoutEvents);
    advanceRespawns(state, stepMs, events, knockoutEvents);
    events.push(...evaluateResult(state));


This preserves the current countdown rule: the tick that changes `COUNTDOWN` to `REGULATION` emits the phase event but does not also move or attack. `advanceRespawns` must ignore player IDs present in this tick's new knockout events so new knockouts are not decremented immediately; existing respawn timers return control within exactly 600 ms.
1. Update `arenaVisualPlan` to derive warning progress from 78 seconds remaining and contraction progress from the new 75-to-40-second window.
1. On `FINISHED`, rematch/reset, room removal, and server reset, clear all pulse state. When an expired disconnected player is removed from a room, remove its owned pulses.
1. Run focused tests, `npm run typecheck`, and `npm run lint`.
1. Commit Task 5:

    git add src/shared/constants.ts src/server/game/projectiles.ts src/server/game/projectiles.test.ts src/server/game/combat.ts src/server/game/combatResolution.ts src/server/game/combatResolution.test.ts src/server/game/simulation.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.ts src/server/rooms/roomManager.test.ts src/client/game/phaser/arenaVisualPlan.ts src/client/game/phaser/arenaVisualPlan.test.ts
    git commit -m "feat: add neon pulse combat"


---

## Task 6: Make prediction and charge/release animation continuous

This task removes the visible charge snap while keeping the server authoritative. At its end, local steering feels immediate, release facing locks, 180/350/699 ms pose-continuity tests pass, and repeated reconciliation snapshots cannot restart one attack or replay one local cue.

**Owner boundary:** client prediction and animation state/pose generation only. Do not render projectile entities or new FX here.

**Files:**

- Modify: `src/client/game/prediction.ts`
- Modify: `src/client/game/prediction.test.ts`
- Modify: `src/client/game/phaser/animationPlan.ts`
- Modify: `src/client/game/phaser/animationPlan.test.ts`
- Modify: `src/client/game/phaser/AnimationDirector.ts`
- Modify: `src/client/game/phaser/AnimationDirector.test.ts`
- Modify: `src/client/game/phaser/LocalActionAudioTracker.ts`
- Modify: `src/client/game/phaser/LocalActionAudioTracker.test.ts`

Add a public charge-pose sampler and a charge-aware release plan:

    export function chargePoseAt(chargeMs: number, reducedMotion: boolean): FighterPose {
      const plan = animationPlanFor('heavy-charge', reducedMotion);
      return poseAt(plan, Math.max(0, Math.min(GAME.heavyMaxChargeMs, chargeMs)));
    }
    
    export function heavyReleasePlanFrom(
      chargeMs: number,
      reducedMotion: boolean
    ): FighterAnimationPlan {
      const release = animationPlanFor('heavy-release', reducedMotion);
      const first = { atMs: 0, pose: chargePoseAt(chargeMs, reducedMotion) };
      return { ...release, transitionMs: 45, keyframes: [first, ...release.keyframes.slice(1)] };
    }


Animation state rules:

- `action.charging === true` selects `heavy-charge` and samples from `chargeMs`, not elapsed wall time.
- A committed `HEAVY` with `charging === false` selects `heavy-release` from the preserved `chargeMs` pose.
- Facing follows predicted/server aim during charge and uses `lockedFacing` after release.
- The same non-null `attackId` never restarts animation or local audio during reconciliation.

1. Add red prediction tests for eight-direction charge steering, last valid aim retention, release locking, early-release cancellation, unchanged attack reconciliation without replay, and never predicting pulse/hit/clash truth.
1. Add red animation tests proving 180, 350, and 699 ms releases begin at the exact preceding charge pose; active contact timing comes from the shared profile; and repeated snapshots with one attack ID do not restart.
1. Run:

    npx vitest run src/client/game/prediction.test.ts src/client/game/phaser/animationPlan.test.ts src/client/game/phaser/AnimationDirector.test.ts src/client/game/phaser/LocalActionAudioTracker.test.ts --maxWorkers=1


Expected: partial-charge release tests fail because the existing release plan always begins from the authored 700 ms pose and action replay is keyed only by coarse kind/state.

1. Extend prediction runtime with retained heavy aim, charge latch, and last presented attack ID. Continue predicting only local kinematics and pose starts.
1. Use shared profile W/A/R durations for quick and heavy plans; remove duplicated hard-coded attack duration ownership from the animation layer.
1. Implement charge sampling and release transition without pausing or modifying server time.
1. Key local action audio deduplication by authoritative attack ID where present and by one monotonic local prediction sequence before acknowledgement.
1. Run focused tests, `npm run typecheck`, and `npm run lint`.
1. Commit Task 6:

    git add src/client/game/prediction.ts src/client/game/prediction.test.ts src/client/game/phaser/animationPlan.ts src/client/game/phaser/animationPlan.test.ts src/client/game/phaser/AnimationDirector.ts src/client/game/phaser/AnimationDirector.test.ts src/client/game/phaser/LocalActionAudioTracker.ts src/client/game/phaser/LocalActionAudioTracker.test.ts
    git commit -m "fix: make charged attacks continuous"


---

## Task 7: Render shared sweeps, charge direction, pulses, and distinct feedback

This task makes every approved outcome readable. At its end, Phaser draws the authoritative sweep and pulse positions, charging fighters communicate direction/readiness, clash/dodge/pulse events have distinct deduplicated FX and audio, the HUD contains no mouse instructions, and reduced motion preserves clarity without changing gameplay timing.

**Owner boundary:** Phaser views, FX/audio, HUD copy/state, generated audio assets, styles, and their tests.

**Files:**

- Modify: `src/client/game/phaser/FighterView.ts`
- Create: `src/client/game/phaser/PulseView.ts`
- Create: `src/client/game/phaser/PulseView.test.ts`
- Modify: `src/client/game/phaser/ArenaScene.ts`
- Modify: `src/client/game/phaser/ArenaScene.integration.test.ts`
- Modify: `src/client/game/phaser/ImpactFx.ts`
- Modify: `src/client/game/phaser/ImpactFx.test.ts`
- Modify: `src/client/game/phaser/PhaserImpactAdapter.ts`
- Modify: `src/client/game/phaser/PhaserImpactAdapter.test.ts`
- Modify: `src/client/game/phaser/GameAudio.ts`
- Modify: `src/client/game/phaser/GameAudio.test.ts`
- Modify: `src/client/game/phaser/PhaserAudioAdapter.ts`
- Modify: `src/client/game/phaser/PhaserAudioAdapter.test.ts`
- Modify: `src/client/ui/MatchHud.tsx`
- Modify: `src/client/ui/MatchHud.test.tsx`
- Modify: `src/client/styles/game.css`
- Modify: `scripts/generate-audio.mjs`
- Generate: `public/assets/audio/clash.wav`
- Generate: `public/assets/audio/perfect-dodge.wav`
- Generate: `public/assets/audio/pulse-spawn.wav`
- Generate: `public/assets/audio/pulse-break.wav`

**Presentation seams:**

    export type AttackTelegraph = Readonly<{
      profileId: AttackProfileId;
      facing: Vec2;
      previousProgress: number;
      currentProgress: number;
      active: boolean;
    }>;
    
    export type ChargeIndicatorState = Readonly<{
      facing: Vec2;
      progress: number;
      pulseReady: boolean;
    }>;
    
    export interface PulseView {
      apply(pulse: MatchPulse): void;
      destroy(): void;
    }


1. Add red view/integration tests that the fighter trail uses shared profile points, every charging fighter shows the compact eight-direction indicator with a stronger local-player treatment, one authoritative pulse is created/updated/removed by projectile ID, and unchanged snapshots create no duplicate view.
1. Add red FX/audio tests that `CLASH`, `PERFECT_DODGE`, `PULSE_SPAWN`, and `PULSE_BREAK` each produce a distinct deduplicated cue; reduced motion suppresses camera displacement/hit-stop but keeps readable flashes and particles.
1. Add red HUD tests for keyboard-only help text, live charge percentage, `PULSE READY` at 700 ms, 78-second contraction warning, transient sudden-death announcement, and absence of all mouse instructions.
1. Run:

    npx vitest run src/client/game/phaser/PulseView.test.ts src/client/game/phaser/ArenaScene.integration.test.ts src/client/game/phaser/ImpactFx.test.ts src/client/game/phaser/PhaserImpactAdapter.test.ts src/client/game/phaser/GameAudio.test.ts src/client/game/phaser/PhaserAudioAdapter.test.ts src/client/ui/MatchHud.test.tsx --maxWorkers=1


Expected: pulse view/module and new adapter methods/cues do not exist, the trail is a fixed polygon, and the HUD still says left/right mouse click.

1. Replace the fixed attack trail polygon with a Phaser path generated from the active shared profile. Draw the capsule thickness rather than a decorative line whose reach differs from the server.
1. Add the eight-direction charge indicator around every charging fighter; update it from current aim and `chargeMs / 700`, lock it with the release facing, and make the local version more prominent without changing gameplay information.
1. Add `pulseViews: Map<number, PulseView>` to `ArenaScene`; reconcile it solely from `snapshot.pulses` and destroy stale views on consumption, reset, scene shutdown, or result.
1. Add deduplicated FX/audio routes for all four events. Use stable event-ID detune and keep all presentation hit-stop at or below 35 ms.
1. Update HUD copy to `WASD`, arrows, `Shift + arrows`, and `Space`; show numeric charge and `PULSE READY` without covering arena play.
1. Extend `scripts/generate-audio.mjs`, run `npm run assets:audio`, and verify all four new WAV files are non-empty.
1. Run focused tests, `npm run typecheck`, `npm run lint`, and `npm run build`.
1. Commit Task 7:

    git add src/client/game/phaser/FighterView.ts src/client/game/phaser/PulseView.ts src/client/game/phaser/PulseView.test.ts src/client/game/phaser/ArenaScene.ts src/client/game/phaser/ArenaScene.integration.test.ts src/client/game/phaser/ImpactFx.ts src/client/game/phaser/ImpactFx.test.ts src/client/game/phaser/PhaserImpactAdapter.ts src/client/game/phaser/PhaserImpactAdapter.test.ts src/client/game/phaser/GameAudio.ts src/client/game/phaser/GameAudio.test.ts src/client/game/phaser/PhaserAudioAdapter.ts src/client/game/phaser/PhaserAudioAdapter.test.ts src/client/ui/MatchHud.tsx src/client/ui/MatchHud.test.tsx src/client/styles/game.css scripts/generate-audio.mjs public/assets/audio/clash.wav public/assets/audio/perfect-dodge.wav public/assets/audio/pulse-spawn.wav public/assets/audio/pulse-break.wav
    git commit -m "feat: present redesigned combat"


---

## Task 8: Prove real LAN gameplay, load, performance, reconnect, and release state

This task converts implementation into delivery evidence. At its end, real keyboard input passes the two-context journey, eight clients and eight browsers meet stability/frame gates, both health addresses work, review findings are resolved, documentation matches behavior, and the same accepted SHA is visible in the public repository.

**Owner boundary:** integration/E2E/load tests, private harness support, README, live browser acceptance, and delivery evidence. Do not change core mechanics unless a failing acceptance test reveals a scoped defect.

**Files:**

- Modify: `src/server/network/createGameServer.ts`
- Modify: `src/server/rooms/roomManager.ts` only if a private deterministic harness method is required
- Modify: `tests/integration/socketFlow.test.ts`
- Modify: `tests/e2e/fixtures.ts`
- Modify: `tests/e2e/knockout.spec.ts`
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `tests/load/eightClients.test.ts`
- Modify: `README.md`
- Update: `.superpowers/sdd/2026-08-28-neon-knockout/task-9-report.md`

The private test harness may gain only in-process helpers with no network exposure:

    testHarness: {
      forceKnockout(roomCode: string, attackerId: string, targetId: string): void;
      disconnectPlayer(roomCode: string, playerId: string): void;
      placePlayer(roomCode: string, playerId: string, position: Vec2, facing: Vec2): void;
      recentEvents(roomCode: string): readonly GameEvent[];
      matchSnapshot(roomCode: string): MatchSnapshot | null;
    };


`recentEvents` is a bounded cloned ring buffer enabled only when `enableTestHarness` is true and cleared on server stop. It exists so browser tests assert authoritative outcomes rather than infer hits from animation.

1. Rewrite the integration combat matrix to prove quick/quick, heavy/quick, heavy/heavy, attack/pulse, pulse/player, perfect dodge, charge interruption, event order, 600 ms respawn, contraction, and sudden death from real `InputFrame` sequences.
1. Rewrite `knockout.spec.ts` as a keyboard-only two-context journey:
  - mouse movement/click does not change facing, action, or position;
  - `WASD` movement works;
  - diagonal quick is authoritative;
  - a steerable partial heavy remains melee-only;
  - a 700 ms charge creates exactly one pulse;
  - clash and perfect dodge produce their authoritative events;
  - reconnect preserves identity/score/stats and starts neutral;
  - result and rematch still work.
1. Keep `forceKnockout` only to shorten the final result/rematch setup after at least one real combat knockout or authoritative combat contact has been proven.
1. Rewrite the eight-browser performance burst to use arrow quick edges, full-charge releases, and `Space` dashes. Preserve the acceptance thresholds: median at least 58 FPS and p95 frame duration below 25 ms.
1. Rewrite the eight-client 10-second load pattern with monotonic 60 Hz keyboard-semantic inputs: movement windows, quick edges, heavy holds/releases, dash edges, and idle windows. Preserve at least 250 snapshots per client, no unexpected server error, and clean handle shutdown.
1. Update README controls, Neon Pulse, clashes, perfect dodge, 600 ms return, 78/75/40 pacing, LAN launch, health checks, and verification commands.
1. Run the focused integration gate:

    npx vitest run tests/integration/socketFlow.test.ts --maxWorkers=1


Expected after the rewrite: green only when authoritative outcomes and event ordering are correct.

1. Run the complete non-browser gate:

    npm run verify


Expected: lint, both typechecks, all Vitest suites, the 8-client load test, and production build pass on the same commit.

1. Stop the previously running production server before the browser build so the E2E worker owns its port/process lifecycle.
1. Run browser automation:

    npm run test:e2e


Expected: two-context combat journey and eight-context performance test pass with no console/page errors.

1. Start the exact accepted production build:

    npm run lan


1. Verify both reachability probes against that process:

    curl --fail http://127.0.0.1:4173/health
    lan_address="$(node --input-type=module -e 'import os from "node:os"; const addresses = Object.values(os.networkInterfaces()).flatMap((value) => value ?? []); const address = addresses.find((value) => value.family === "IPv4" && !value.internal && (value.address.startsWith("10.") || value.address.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(value.address))); if (!address) process.exit(1); process.stdout.write(address.address);')"
    test -n "$lan_address"
    curl --fail "http://${lan_address}:4173/health"


Expected: both return HTTP 200. Confirm that `lan_address` equals an address printed by this exact `npm run lan` process; if the server selected another printed private address, set `lan_address` to that literal address and repeat the second probe.

1. Use two isolated real browser contexts at 900×600 or larger to repeat create/join/ready/start, movement, diagonal quick, partial heavy steering/release, full-charge pulse, clash/perfect dodge, one knockout, reconnect, result, and rematch.
1. Visually inspect default and reduced-motion modes for clipped HUD, hidden fighters, permanent announcements, charge snap, stale pulses, or trails that disagree with the shared sweep.
1. Confirm the public GitHub remote and repository visibility, then ensure no generated browser artifacts are staged:

    git status --short
    git remote -v
    gh repo view reitenji/neon-relay --json nameWithOwner,visibility,url


1. Update the Task 9 report with the accepted commit SHA and exact test/browser/LAN evidence.
1. Commit the delivery slice:

    git add src/server/network/createGameServer.ts src/server/rooms/roomManager.ts tests/integration/socketFlow.test.ts tests/e2e/fixtures.ts tests/e2e/knockout.spec.ts tests/e2e/performance.spec.ts tests/load/eightClients.test.ts README.md .superpowers/sdd/2026-08-28-neon-knockout/task-9-report.md
    git commit -m "test: prove redesigned lan combat"


1. Re-run `npm run verify` and `npm run test:e2e` after the final commit so all evidence points at one SHA.
1. Push the feature branch, verify upstream equality, merge to `main` only after the read-only review and complete proof in `Concrete Steps`, push `main`, and verify GitHub shows the same accepted SHA:

    git push -u origin feat/neon-relay-game
    git rev-parse HEAD
    git rev-parse origin/feat/neon-relay-game
    git log -1 --oneline


## Concrete Steps

Run every command from `/Users/serkances/dev/game/.worktrees/neon-relay-implementation`. First confirm the expected toolchain and install the locked dependencies only if this worktree has no `node_modules` directory:

    pwd
    node --version
    npm --version
    test -d node_modules || npm ci

The first line must print the implementation worktree path, Node must be version 20 or newer, and `npm ci` must finish without changing `package-lock.json`. Follow Tasks 0 through 8 in dependency order, using the focused red/green commands and exact commits embedded in each task. The selected subagent-driven workflow runs one implementer at a time and requires an independent review before the next task.

After the final implementation commit, run the complete proof on that unchanged SHA:

    npm run verify
    npm run test:e2e
    git diff --check
    git status --short

`npm run verify` must finish with zero failed lint rules, zero TypeScript errors, zero failed Vitest tests, one passing eight-client load test, and a successful production build. `npm run test:e2e` must report both Playwright scenarios passed: the two-context combat journey and the eight-context frame-budget test. `git diff --check` must print nothing. `git status --short` may show the known generated `.playwright-cli/` and `output/` paths but no unstaged source change.

Search for unfinished implementation markers without making this plan match its own search command:

    marker_pattern='TO''DO|T''BD|FIX''ME|place''holder'
    rg -n "$marker_pattern" src tests scripts README.md

The command should produce no finding introduced by this redesign. Prepare the exact review range and inspect its size:

    git diff --stat 0d4d180...HEAD
    git diff --find-renames 0d4d180...HEAD -- src tests scripts README.md package.json playwright.config.ts vitest.config.ts

Assign a read-only reviewer that same repository and commit range together with this exact request: “Review `0d4d180...HEAD` against `docs/superpowers/specs/2026-08-31-core-combat-redesign-design.md` and this ExecPlan. Report only actionable correctness, determinism, security, performance, or test-realism findings, with file and line evidence. Focus on attack/pulse target deduplication, projectile cleanup, blur/release input gating, reconciliation replay, countdown/respawn phase order, and test-only API leakage.” A human reviewer can use the second command's output as the review artifact; an agent reviewer should inspect the same range directly so generated audio binaries do not obscure source review. Record every finding and disposition in `Surprises & Discoveries` or `Decision Log`; fix validated findings, rerun their focused tests, and repeat the complete proof above.

For the live proof, ensure only this project owns port 4173, start `npm run lan`, retain its terminal output, and perform the dual health probes and two-browser journey described in Task 8. Stop that server with Ctrl-C after evidence is captured. Update `Progress`, `Outcomes & Retrospective`, and `.superpowers/sdd/2026-08-28-neon-knockout/task-9-report.md` with the final SHA and concise outputs.

Publish only after all review and acceptance evidence points to the same commit:

    git push -u origin feat/neon-relay-game
    git fetch origin
    test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/neon-relay-game)"
    gh repo view reitenji/neon-relay --json nameWithOwner,visibility,url

The equality test must exit zero, and GitHub must report `PUBLIC`. The branch name `feat/neon-relay-game` resolves from the main checkout because Git worktrees share one repository's branch/object storage; it is the branch checked out by this implementation worktree. To fast-forward the main checkout, move to `/Users/serkances/dev/game`, confirm it has no unrelated tracked changes, merge without creating a second history, and push:

    cd /Users/serkances/dev/game
    git status --short
    git fetch origin
    git merge --ff-only feat/neon-relay-game
    git push origin main
    test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

If the main checkout is dirty, the fast-forward is impossible, or the remote moved unexpectedly, do not reset, force-push, or discard files. Record the exact blocker and resolve it without overwriting user work.

## Validation and Acceptance

Acceptance is behavioral. In a real two-browser match, moving or clicking the mouse must leave movement, facing, and attack state unchanged. `WASD` must move; a cardinal or diagonal arrow press must make one quick attack and must not repeat while held; holding `Shift` and changing arrows must steer charge; releasing all arrows must retain the last direction; releasing `Shift` at or after 180 ms must lock and release; `Space` must dash.

A partial heavy must begin its release from the exact visible charge pose and create no pulse. A 700 ms charge must create exactly one server-owned pulse visible at the same position in both browsers. A quick/quick clash, heavy/quick priority, heavy/heavy clash, attack/pulse break, and first avoided dash contact must match the deterministic server tests and produce distinct, one-time visual/audio feedback. Confirmed hits must intersect the shared visible capsule and known epsilon-outside near misses must not create `HIT` events.

A knockout must restore control in 600 ms, reset overload, preserve score/statistics, and apply no extra penalty. A self-fall must award no point. The warning must begin at 78 seconds remaining, contraction at 75, minimum arena at 40, and a tied regulation result must enter minimum-arena sudden death where only the next credited knockout wins.

Reconnect must preserve identity, chassis, accent, score, statistics, and authoritative overload while clearing client-held keys. Result and rematch must still work. The eight-client load test must deliver at least 250 snapshots per client in ten seconds with no unexpected errors or leaked handles. The eight-browser performance scenario must sustain median 58 FPS or better and p95 frame duration below 25 ms on the acceptance host. Both localhost and the printed private-LAN `/health` URL must return HTTP 200. GitHub must show the accepted commit in the public `reitenji/neon-relay` repository.

## Idempotence and Recovery

Unit, integration, load, build, health, and browser commands are safe to repeat. `npm run assets:audio` is deterministic and may be rerun; inspect `git diff` afterward and commit only the four new cues plus intentional generator changes. Starting `npm run lan` is reversible with Ctrl-C. Before starting or stopping a server, use `lsof -nP -iTCP:4173 -sTCP:LISTEN` to identify the owning process and stop only the process launched from this project.

Each task ends in a green commit, so a failed later task can be repaired without touching accepted earlier work. Do not use `git reset --hard`, `git checkout --`, force-push, or broad recursive deletion. If a generated Playwright path must be cleaned, first confirm it is exactly this worktree's `.playwright-cli/` or `output/` directory and that it contains no user-authored artifact; otherwise leave it untracked. If a published change must be reversed, use a normal `git revert` commit and rerun the full gate.

The private test harness exists only when `enableTestHarness: true`. If an E2E helper is observable through an HTTP route, Socket.IO event, or production `GameServer` instance with the flag disabled, treat that as a release blocker and remove the exposure rather than documenting an exception.

## Artifacts and Notes

Baseline implementation commit is `0d4d180` (`docs: define core combat redesign`). The design source is `docs/superpowers/specs/2026-08-31-core-combat-redesign-design.md`. Delivery evidence belongs in `.superpowers/sdd/2026-08-28-neon-knockout/task-9-report.md`; record concise command, pass/fail, duration, accepted SHA, browser viewport, measured median FPS/p95, localhost URL, and current printed LAN URL.

Useful success excerpts should resemble:

    ✓ tests/load/eightClients.test.ts (1 test)
    2 passed
    HTTP/1.1 200 OK

Do not copy long logs into this plan. Record only the few lines that prove a task, and put unexpected behavior plus its evidence in `Surprises & Discoveries`.

## Interfaces and Dependencies

No new runtime package is needed. Use the project's existing TypeScript, Socket.IO, Phaser, React, Zod, Vitest, and Playwright versions. Shared combat code under `src/shared/combat/` must import only pure shared types/constants and must not import Phaser, DOM, Socket.IO, or server state. The server consumes shared profiles and geometry; Phaser consumes the same profile/geometry output for trails. This dependency direction prevents the browser from defining separate hit truth.

The final stable interfaces are the `AttackProfile`, `HurtCircle`, and `SweptCapsule` functions in Task 1; keyboard `ArenaInputSource` in Task 2; `MatchAction`, `MatchPulse`, `GameEvent`, `AttackRuntime`, and `PulseRuntime` in Task 3; melee resolution in Task 4; projectile lifecycle in Task 5; charge pose sampling in Task 6; and `AttackTelegraph`, `ChargeIndicatorState`, and `PulseView` in Task 7. Their exact signatures and values are embedded above. `InputFrame` and the `match:input` Socket.IO event remain unchanged.

Plan revision note (2026-08-31 06:28Z): rewrote the initial task list as a self-contained living ExecPlan after review found missing lifecycle sections, an incorrect pulse/countdown phase order, a stale hardcoded LAN address, and implicit review/release steps. The revision preserves the approved design while making progress tracking, recovery, proof, and publication executable by a stateless contributor.

Plan revision note (2026-08-31 06:40Z): added Task 0 after the first clean-worktree baseline exposed that Vitest was collecting Playwright `.spec.ts` files. Also changed the independent Task 1/2 execution note from parallel implementers to sequential reviewed dispatches to match the selected subagent-driven workflow.
