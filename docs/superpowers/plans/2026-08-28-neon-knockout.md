# Neon Knockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected Neon Relay core-carrying game with a polished, fast, 2–8 player Phaser-powered LAN arena brawler whose combat, reconnect flow, responsive UI, automated tests, and host/join documentation are fully verified and published to the public GitHub repository.

**Architecture:** Keep the proven Node.js, Express, Socket.IO, room-code, resume-token, LAN discovery, and React shell foundations. Replace team/core state with a deterministic 60 Hz free-for-all combat simulation, expose only canonical snapshots and events over Socket.IO, and render those through a typed bridge into Phaser 4.2.1 while React owns accessible menus and HUD. Local movement and attack presentation are predicted; hits, knockouts, scores, respawns, pauses, and results remain server-authoritative.

**Tech Stack:** Node.js 20+, TypeScript 6, React 19, Vite 8, Phaser 4.2.1, Express 5, Socket.IO 4, Zod 4, Vitest 4, Testing Library, and Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-neon-knockout-design.md`

## Global Constraints

The game is desktop-only and requires keyboard plus mouse; no mobile or touch controls are added. One host command must serve the game to desktop browsers on the same LAN, with no guest installation, account, cloud service, database, or internet requirement after host dependencies are installed. The mode is free-for-all for 2–8 players, regulation lasts 120 seconds, the first player to 5 knockouts wins, and a knockout returns control within 700 ms with no negative or escalating penalty. Disconnecting never awards a knockout or fall; a valid resume preserves identity, score, statistics, chassis, accent, and overload. Phaser 4.2.1 is pinned exactly and owns arena rendering, animation, tweens, particles, camera, input integration, asset loading, and sound playback, but never authoritative physics. The server simulates at 60 Hz, broadcasts at 30 Hz, accepts no more than 60 client input frames per second, and rate-limits at 90 valid gameplay inputs per second. Every fighter has identical gameplay values; the four chassis differ only in authored silhouette and animation. The supported minimum viewport is 900×600 CSS pixels. Obsolete team, core, reactor, delivery, tackle, and hand-written Canvas paths are removed rather than preserved behind compatibility switches.

---

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current after every stopping point. The plan follows the local execution-plan rules in `/Users/serkances/.codex/PLANS.md`; all repository paths below are relative to `/Users/serkances/dev/game/.worktrees/neon-relay-implementation` unless an absolute path is shown.

## Purpose / Big Picture

The current build is reachable over LAN and has a working room flow, but live playtesting proved that its core loop and presentation are not enjoyable: players carry neutral cores back toward their own side, contact matters only against a carrier, fighters are primitive Canvas geometry, and there is no complete hit-animation-camera-audio stack. After this plan, two to eight friends can open the host's LAN URL, choose visually distinct mech gladiators, enter a fast free-for-all, use quick combos, charged heavy strikes, and dash recovery, knock one another from a shrinking arena, reconnect without punishment, and rematch without rejoining.

The final result is demonstrated, not inferred. A clean install must pass unit, integration, load, and Playwright suites; the production server must respond through localhost and one real private LAN address; two browser contexts must complete create/join/ready/combat/result/rematch and reconnect flows; an eight-client effect burst must meet the frame-time target; supported viewports must be visually inspected; and the exact accepted commit must be pushed to `https://github.com/reitenji/neon-relay` with local and remote `main` SHAs equal.

## Progress

- [x] (2026-08-28 11:29Z) User approved the combat-first redesign and the shortened, penalty-free knockout/reconnect amendments in `2b4e909`.
- [x] (2026-08-28 11:29Z) Mapped the current shared, simulation, room, network, client, test, build, and delivery surfaces; recorded the superseded uncommitted Task 7 test drafts.
- [x] (2026-08-28 11:56Z) Task 1: Replaced shared team/core contracts with reviewed free-for-all combat contracts and browser-safe kinematics (`0120139`, `3c3f328`).
- [x] (2026-08-28 12:14Z) Task 2: Built reviewed deterministic platform geometry, velocity movement, dash lifecycle, separation, and safe spawns (`0f3ce03`, `3668441`).
- [ ] Task 3: Implement authoritative attacks, knockback, knockout, respawn, contraction, and match transitions.
- [ ] Task 4: Convert rooms, reconnect behavior, Socket.IO handlers, and the test harness to free-for-all combat.
- [ ] Task 5: Convert the client network/store and React landing, lobby, reconnect, and result flows.
- [ ] Task 6: Integrate Phaser 4.2.1 through a typed bridge with input, prediction, interpolation, mount, and teardown.
- [ ] Task 7: Create the four fighter assets and the continuous authored animation system.
- [ ] Task 8: Add impact effects, original audio, combat HUD, responsive styling, and polish states.
- [ ] Task 9: Add socket load, two-browser E2E, performance, README, and production-LAN acceptance automation.
- [ ] Task 10: Run completion audit, visual review, three load runs, live LAN acceptance, merge, public push, and SHA verification.

## Surprises & Discoveries

- Observation: Stable commit `07c1001` passed 113 tests, lint, typecheck, and build, but the current worktree is intentionally not clean because an interrupted superseded task left modified tests and three untracked test files.
  Evidence: `git status --short` lists `src/client/state/gameStore.test.ts`, `src/client/ui/LandingScreen.test.tsx`, `src/server/rooms/roomManager.test.ts`, `src/client/game/audio.test.ts`, `src/client/ui/ConnectionOverlay.test.tsx`, and `src/client/ui/ResultScreen.test.tsx`. The useful landing validation and reconnect-duration assertions must be adapted; old core/team/audio vocabulary must not be committed unchanged.
- Observation: The existing room and server lifecycle boundaries are worth preserving.
  Evidence: `RoomManager` already owns resume tokens, host migration, fixed-step accumulation, snapshot cadence, room deletion, and rematch transitions; `createGameServer()` already exposes an in-process-only test harness and idempotent start/stop behavior.
- Observation: Phaser's client physics must not be used as the source of truth.
  Evidence: the approved design requires canonical server outcomes and repeatable replay; Phaser is used for rendering and presentation while shared pure kinematics supports prediction.
- Observation: A read-only planning agent crossed its ownership boundary and committed the initial plan plus a partial shared-contract migration, then left server-game edits unfinished in the working tree.
  Evidence: commits `232f070` and `2310543` are reviewable and useful, while `git status --short` showed a deleted `simulation.ts` beside rewritten tests and state. The work is being preserved, reviewed, and completed as Task 1-3 instead of reset or silently discarded.

## Decision Log

- Decision: Keep the repository and public remote named `neon-relay`, but rename product copy and package metadata to Neon Knockout.
  Rationale: The public repository already exists and changing its URL adds delivery risk without improving the game.
  Date/Author: 2026-08-28 / Codex.
- Decision: Use one free-for-all mode and four cosmetic chassis with equal hitboxes and timing.
  Rationale: This keeps 2–8 player rooms fair, removes team imbalance, and concentrates polish on readable combat rather than class balance.
  Date/Author: 2026-08-28 / User and Codex.
- Decision: Pin Phaser `4.2.1` and isolate it behind `GamePresentationBridge`.
  Rationale: Phaser supplies the animation, camera, particle, input, and sound systems requested by the user while the bridge prevents renderer lifecycle from contaminating network/domain code.
  Date/Author: 2026-08-28 / Codex.
- Decision: A normal knockout returns control in 700 ms, and reconnect entry takes only 180 ms while retaining overload and statistics.
  Rationale: The user explicitly rejected long downtime and player punishment.
  Date/Author: 2026-08-28 / User and Codex.
- Decision: Represent an expired under-populated match as a `NO_CONTEST` event followed by a lobby room state.
  Rationale: Players need a clear explanation without treating a connection loss as a win, loss, knockout, or fall.
  Date/Author: 2026-08-28 / Codex.

## Outcomes & Retrospective

Task 1 produced the exact serializable combat/input/protocol surface, exact shared limits, and pure prediction kinematics. Its 10 focused tests passed; an independent review found three contract mismatches, all fixed in `3c3f328` and confirmed by scoped re-review. Task 2 produced deterministic octagon geometry, movement, void recovery, separation, safe spawns, and a fully timed/invulnerable dash; its 14 focused tests passed twice after an independent review caught and verified the dash timer fix in `3668441`. At final completion, compare the live game against the three product promises: immediate control, readable impact, and constant contest.

## Context and Orientation

The implementation branch is `feat/neon-relay-game` in the isolated worktree `/Users/serkances/dev/game/.worktrees/neon-relay-implementation`. The root checkout `/Users/serkances/dev/game` is reserved for final integration to `main`. Do all Tasks 1–9 in the implementation worktree and do not stage unrelated files.

`src/shared/model.ts`, `src/shared/protocol.ts`, and `src/shared/constants.ts` are the contract shared by browser and server. They currently contain `Team`, cores, reactors, delivery statistics, and boolean direction input; Task 1 replaces them atomically. `src/server/game/state.ts`, `geometry.ts`, and `simulation.ts` form the pure game domain. A "pure" domain here means code that receives state plus inputs and returns state/events without importing Socket.IO, React, Phaser, DOM APIs, or clocks. `src/server/rooms/roomManager.ts` owns membership, sessions, fixed-step scheduling, and match lifecycle. `src/server/network/socketHandlers.ts` validates public socket messages, while `createGameServer.ts` composes HTTP, Socket.IO, publications, health, and the private test harness.

`src/client/network/GameClient.ts` is the typed Socket.IO wrapper. `src/client/state/gameStore.ts` translates network state into screens and actions. `src/client/App.tsx` selects landing, lobby, match, and result screens. `src/client/game/GameCanvas.tsx`, `renderer.ts`, `keyboard.ts`, and the current `prediction.ts` are the rejected hand-written arena client; Task 6 replaces them with Phaser and deletes them after the new mount passes. React remains responsible for text, forms, focus, HUD, reconnect overlay, mute control, and result actions.

Vitest currently runs in jsdom for every file. Server-only load tests must opt into the Node environment with the file pragma `// @vitest-environment node`. Playwright tests will use an in-process `GameServer` fixture rather than a production socket or HTTP cheat endpoint. `npm run verify` is the broad source/build gate; the plan adds `test:load`, strengthens `test:e2e`, and makes `verify` include focused Node/load configuration without running long visual acceptance twice.

## Target File Map

The shared layer will retain `src/shared/model.ts`, `protocol.ts`, `constants.ts`, and `names.ts`, and add `src/shared/kinematics.ts` with `kinematics.test.ts`. Model owns serializable readonly shapes only; protocol owns Zod schemas and Socket.IO event signatures; constants owns tuning, chassis/accent lists, and arena vertices; kinematics owns pure velocity integration used by server and local prediction.

The server game layer will retain `state.ts`, `geometry.ts`, and `simulation.ts`, and add `movement.ts`, `movement.test.ts`, `combat.ts`, and `combat.test.ts`. Geometry owns vectors and polygon queries. Movement owns platform contraction, acceleration, drag, dash velocity, void pull, and separation. Combat owns attack timelines, hit arcs, overload, hitstun, and target deduplication. Simulation owns phase ordering, timer/respawn/knockout/result transitions, snapshots, connectivity, and the forced-knockout domain command.

The Phaser client will add `src/client/game/GamePresentationBridge.ts`, `PhaserArena.tsx`, `phaser/createNeonGame.ts`, `phaser/BootScene.ts`, `phaser/ArenaScene.ts`, `phaser/ArenaInput.ts`, `phaser/fighterManifest.ts`, `phaser/FighterView.ts`, `phaser/animationPlan.ts`, `phaser/AnimationDirector.ts`, `phaser/ImpactFx.ts`, and `phaser/GameAudio.ts`, with focused sibling tests for pure controllers and injected lifecycle seams. The current Canvas renderer and keyboard controller are deleted only after the Phaser mount, input, and prediction tests pass.

The final assets live under `public/assets/fighters/`, `public/assets/arena/`, `public/assets/fx/`, and `public/assets/audio/`. Four fighters use layered transparent SVG textures for body, left arm, right arm, and core so Phaser can animate poses continuously without relying on inconsistent generated sprite-sheet frames. A concept sheet may be generated for visual direction, but final assets must be inspectable, transparent, original, and free from baked checkerboards or stock marks. `scripts/generate-audio.mjs` deterministically creates the short original WAV cues checked into `public/assets/audio/`.

## Milestone 1: A New Deterministic Game Exists Without a Renderer

Tasks 1–4 replace the rules from the inside out. At the end of this milestone, two real Socket.IO clients can create a room, choose chassis, ready, start, exchange combat input, receive hit/knockout/snapshot events, reconnect without a penalty, enter `NO_CONTEST` when necessary, and rematch. The old browser may not render the new match yet, but unit and integration tests prove the entire authoritative game.

### Task 1: Replace shared contracts

**Files:** Modify `src/shared/model.ts`, `src/shared/protocol.ts`, `src/shared/constants.ts`, `src/shared/protocol.test.ts`; create `src/shared/kinematics.ts` and `src/shared/kinematics.test.ts`; later tasks consume these exact names.

**Interfaces produced:** `Chassis`, `PlayerAccent`, `AttackKind`, `AttackPhase`, `InputFrame`, `PlayerStats`, `RoomPlayer`, `RoomState`, `MatchPlayer`, `MatchSnapshot`, `GameEvent`, `ClientToServerEvents`, `ServerToClientEvents`, `GAME`, `ARENA`, `CHASSIS`, `ACCENTS`, `KinematicState`, and `advanceKinematics()`.

**Step 1 — write the red contract tests.** Replace team/core fixtures in `protocol.test.ts` and create `kinematics.test.ts`. The tests must assert strict chassis parsing, finite bounded axes, rejection of legacy button fields, stable room/match serialization, movement normalization, zero-aim retention, and constants copied from the approved spec. Use concrete payloads such as:

    expect(matchInputSchema.safeParse({
      seq: 7,
      moveX: 1,
      moveY: 0,
      aimX: 0.6,
      aimY: -0.8,
      quick: true,
      heavy: false,
      dash: false
    }).success).toBe(true);
    expect(matchInputSchema.safeParse({
      seq: 8,
      up: true,
      down: false,
      left: false,
      right: false,
      dash: false
    }).success).toBe(false);

**Step 2 — prove RED.** From the implementation worktree run:

    npx vitest run src/shared/protocol.test.ts src/shared/kinematics.test.ts

Expect compilation failures for missing `Chassis`, `KinematicState`, and `advanceKinematics`, or failing legacy-schema assertions. Record the short failure in `Surprises & Discoveries` if it differs.

**Step 3 — implement the shared contract.** Replace `model.ts` with readonly serializable types. Use these exact primary shapes:

    export const CHASSIS = ['RIFT', 'BASTION', 'PULSE', 'WRAITH'] as const;
    export type Chassis = (typeof CHASSIS)[number];
    export type PlayerAccent = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    export type InputFrame = Readonly<{
      seq: number;
      moveX: number;
      moveY: number;
      aimX: number;
      aimY: number;
      quick: boolean;
      heavy: boolean;
      dash: boolean;
    }>;
    export type PlayerStats = Readonly<{
      knockouts: number;
      falls: number;
      landedHits: number;
      completedAttacks: number;
    }>;

`RoomPlayer` contains `playerId`, `name`, `chassis`, `accent`, `ready`, `connected`, `reconnectRemainingMs`, and `stats`. `MatchPlayer` contains identity plus `position`, `velocity`, `facing`, `overload`, `lastProcessedInputSeq`, `action`, `dashRemainingMs`, `dashCooldownRemainingMs`, `hitstunRemainingMs`, `respawnRemainingMs`, `protectionRemainingMs`, and stats. `MatchSnapshot` contains `tick`, `phase`, `remainingMs`, `platformProgress`, `scores: Readonly<Record<string, number>>`, sorted players, `winnerPlayerId`, and `resultReason`. Every `GameEvent` carries monotonically increasing `eventId` and server `tick`; define `HIT`, `KNOCKOUT`, `RESPAWN`, `PHASE`, `NO_CONTEST`, and `RESULT` variants.

In `protocol.ts`, replace `lobby:team` with `lobby:chassis`, replace the input schema, and add strict finite `z.number().min(-1).max(1)` axis schemas. In `constants.ts`, copy the exact 60/30 Hz cadence, 120-second match, 5-KO target, 700 ms knockout control time, 650 ms protection, movement/attack tuning, chassis list, accent palette, regulation/minimum octagon vertices, and deterministic spawn anchors from the spec. Do not leave old exports aliased.

In `kinematics.ts`, export:

    export type KinematicState = Readonly<{
      position: Vec2;
      velocity: Vec2;
      facing: Vec2;
    }>;
    export function normalizeAxes(x: number, y: number): Vec2;
    export function normalizeAim(x: number, y: number, previous: Vec2): Vec2;
    export function advanceKinematics(
      state: KinematicState,
      input: Pick<InputFrame, 'moveX' | 'moveY' | 'aimX' | 'aimY'>,
      elapsedMs: number,
      options: Readonly<{ dashVelocity: Vec2 | null; steeringScale: number; voidPull: Vec2 }>
    ): KinematicState;

Use semi-implicit Euler integration with seconds derived from `elapsedMs`, clamp ground target speed, apply acceleration toward input, apply exponential drag only when no ground input, then add dash/void contributions. Server-only collision stays out of this file.

**Step 4 — prove GREEN and remove legacy symbols.** Run the focused tests, then:

    rg -n "Team|CYAN|AMBER|MatchCore|coreId|carriedCore|delivery|reactor" src/shared
    npm run typecheck

The focused tests pass. The search returns no runtime shared-contract hits; typecheck is expected to reveal downstream files that Tasks 2–6 must migrate, so do not weaken types to make legacy consumers compile. Commit only the shared task files:

    git add src/shared/model.ts src/shared/protocol.ts src/shared/constants.ts src/shared/protocol.test.ts src/shared/kinematics.ts src/shared/kinematics.test.ts
    git commit -m "refactor: define Neon Knockout contracts"

### Task 2: Deterministic arena geometry and movement

**Files:** Rewrite `src/server/game/geometry.ts` and `geometry.test.ts`; create `src/server/game/movement.ts` and `movement.test.ts`; rewrite the state types and factory in `src/server/game/state.ts` enough to support movement fixtures.

**Interfaces consumed:** `GAME`, `ARENA`, `InputFrame`, `Vec2`, `KinematicState`, `advanceKinematics()` from Task 1. **Interfaces produced:** `PlatformGeometry`, `platformAt()`, `pointInConvexPolygon()`, `distanceToPolygon()`, `nearestEdgeNormal()`, `advancePlayers()`, `separateActivePlayers()`, `MatchState`, and `createMatchState()`.

**Step 1 — write geometry and movement failures.** Cover all eight regulation and minimum vertices, interpolation at 0/0.5/1, inside/outside distance, 80-pixel knockout threshold, 360 px/s² outward pull, 45% off-platform steering, acceleration/max speed/drag, dash direction fallback to facing, player separation, and deterministic safest spawn selection. A representative assertion is:

    const platform = platformAt(0.5);
    expect(platform.vertices[0]).toEqual({ x: 280, y: 120 });
    expect(distanceToPolygon({ x: 640, y: 360 }, platform.vertices)).toBe(0);
    expect(isKnockedOut({ x: 640, y: -1 }, platform)).toBe(true);

**Step 2 — prove RED.** Run:

    npx vitest run src/server/game/geometry.test.ts src/server/game/movement.test.ts

Expect missing-module or missing-function failures.

**Step 3 — implement focused modules.** `geometry.ts` exports pure vector/polygon functions and computes distance to every segment without rounding. `movement.ts` exports:

    export type PlatformGeometry = Readonly<{ vertices: readonly Vec2[] }>;
    export function platformAt(progress: number): PlatformGeometry;
    export function advancePlayers(state: MatchState, stepMs: number): void;
    export function separateActivePlayers(state: MatchState): void;
    export function chooseSafestSpawn(state: MatchState, playerId: string): Vec2;

`state.ts` defines `MutableMatchPlayer`, `AttackRuntime`, and `MatchState`. `createMatchState(seeds, seed)` sorts seeds by stable player ID, assigns deterministic spawn anchors, starts `COUNTDOWN` at 3,000 ms, creates zeroed scores/stats, and initializes every player's last valid facing to `(1,0)`. Keep attack resolution out of this task; movement fixtures may set action timers directly.

**Step 4 — prove movement GREEN.** Run the two focused files twice and compare serialized final fixtures to prove repeatability:

    npx vitest run src/server/game/geometry.test.ts src/server/game/movement.test.ts
    npx vitest run src/server/game/geometry.test.ts src/server/game/movement.test.ts

Both runs pass with identical assertion counts. Then commit:

    git add src/server/game/geometry.ts src/server/game/geometry.test.ts src/server/game/movement.ts src/server/game/movement.test.ts src/server/game/state.ts
    git commit -m "feat: add deterministic knockout movement"

### Task 3: Authoritative combat and match simulation

**Files:** Create `src/server/game/combat.ts` and `combat.test.ts`; rewrite `src/server/game/simulation.ts` and `simulation.test.ts`; adjust `state.ts` only for fields proven necessary by tests.

**Interfaces consumed:** movement/state interfaces from Task 2. **Interfaces produced:** `startActions()`, `resolveAttackHits()`, `stepMatch()`, `snapshotMatch()`, `setPlayerConnected()`, and `forceKnockout()`.

**Step 1 — write combat and lifecycle tests.** Name tests after observable behavior: quick combo buffers only in the final 120 ms; each attack target is hit once; quick steps use their exact windup/active/recovery windows; heavy charge clamps at 180–700 ms; dash cancels only uncommitted charge; protection rejects hits but cancels before the protected player attacks; overload multiplier and 90–230 ms hitstun are exact; normal knockout credits the last attacker inside four seconds; self-fall gives no point; control returns at 700 ms; contraction warns/contracts at the specified clock; unique timed leader wins; tied leaders enter sudden death; repeated replay emits identical ordered events.

Use event assertions rather than internal-only flags:

    expect(events).toContainEqual(expect.objectContaining({
      type: 'HIT',
      attackerId: 'p1',
      targetId: 'p2',
      attack: 'QUICK_1',
      resultingOverload: 8
    }));

**Step 2 — prove RED.** Run:

    npx vitest run src/server/game/combat.test.ts src/server/game/simulation.test.ts

Expect missing combat exports and old core assertions to fail.

**Step 3 — implement the phase pipeline.** `combat.ts` owns attack state transitions and forward-arc hit testing. Use squared distance followed by normalized dot-product arc checks, stable target ordering, and a `Set<string>` on each attack runtime to prevent repeated hits. `simulation.ts` exports:

    export function stepMatch(
      state: MatchState,
      inputs: ReadonlyMap<string, InputFrame>,
      stepMs: number
    ): readonly GameEvent[];
    export function snapshotMatch(state: MatchState): MatchSnapshot;
    export function setPlayerConnected(
      state: MatchState,
      playerId: string,
      connected: boolean
    ): readonly GameEvent[];
    export function forceKnockout(
      state: MatchState,
      attackerId: string,
      targetId: string
    ): readonly GameEvent[];

Follow the nine-phase order in the spec exactly. `setPlayerConnected(false)` removes the player without awarding or changing statistics. `setPlayerConnected(true)` preserves overload and schedules the 180 ms warp entry plus 650 ms protection. `forceKnockout()` calls the same private knockout transition used by boundary detection; it exists only for in-process tests.

**Step 4 — prove GREEN, determinism, and deletion.** Run focused tests plus:

    npx vitest run src/server/game
    rg -n "PICKUP|DROP|TACKLE|SCORE|golden-core|forceDelivery|resolveReactor" src/server/game

All server game tests pass and the search returns no legacy runtime path. Commit:

    git add src/server/game
    git commit -m "feat: implement authoritative knockout combat"

## Milestone 2: Rooms and Browsers Speak the New Game

Tasks 4–6 connect the pure domain to real sockets and then to Phaser. At the end, two browsers can play the new match with basic but correct visuals, and all old Canvas/team/core code is gone.

### Task 4: FFA rooms, reconnect, Socket.IO, and test harness

**Files:** Rewrite/adapt `src/server/rooms/roomManager.ts`, `roomManager.test.ts`, `domainError.ts`, `src/server/network/socketHandlers.ts`, `createGameServer.ts`, `tests/integration/socketFlow.test.ts`, and `serverLifecycle.test.ts`.

**Interfaces consumed:** all Tasks 1–3 contracts. **Interfaces produced:** `RoomManager.setChassis()`, `applyInput()`, `forceKnockout()`, `debugRoom()`, publications, and the revised `GameServer.testHarness`.

**Step 1 — adapt and add red tests.** Keep the useful uncommitted reconnect-duration test, but replace team/delivery fixtures. Prove deterministic lowest-unused accent assignment, chassis cycling and validation, chassis change resetting ready, 2–8 FFA start, 60/30 Hz pacing, monotonic input, no-penalty disconnect, 20-second reservation, 180 ms resume entry, match continuation with at least two connected players, paused clocks below two, `NO_CONTEST` after the last valid opponent reservation expires, host migration, result/rematch, and cleanup. Integration tests must assert `HIT`, five forced `KNOCKOUT`s, player winner, result stats, resume identity, and no production test socket event.

**Step 2 — prove RED.** Run:

    npx vitest run src/server/rooms tests/integration/socketFlow.test.ts tests/integration/serverLifecycle.test.ts

Expect failures for removed team methods, missing chassis handler, and missing forced knockout harness.

**Step 3 — implement room/network migration.** Replace private room players with `chassis`, `accent`, free-for-all stats, and reconnect expiry. Remove `nextTiedTeam`, `assignTeam()`, `setTeam()`, and team-balance checks. Add:

    setChassis(connectionId: string, chassis: Chassis): void;
    forceKnockout(roomCode: string, attackerId: string, targetId: string): void;
    debugRoom(roomCode: string): Readonly<{
      phase: RoomPhase;
      connectedCount: number;
      reservedCount: number;
      playerIds: readonly string[];
      tick: number | null;
      scores: Readonly<Record<string, number>> | null;
    }> | null;

`debugRoom()` returns copies only—never tokens, mutable maps, or expiration timestamps. `advance()` uses `GAME.tickRate` and `GAME.snapshotRate`; pause only the domain simulation, not reservation clocks. Expired under-population publishes one `NO_CONTEST` event, resets the room to lobby, preserves members/chassis/accent, and clears match statistics.

Update socket schemas/handlers to `lobby:chassis` and the numeric/aim input. Raise the input bucket to 90/s and retain the 10/s room-action bucket. Revise the in-process harness to:

    testHarness: {
      forceKnockout(roomCode: string, attackerId: string, targetId: string): void;
      disconnectPlayer(roomCode: string, playerId: string): void;
      matchSnapshot(roomCode: string): MatchSnapshot | null;
    } | null;

No HTTP or Socket.IO event exposes the harness.

**Step 4 — prove socket GREEN.** Run the focused suite, then run the integration test twice to catch listener leakage:

    npx vitest run src/server/rooms tests/integration/socketFlow.test.ts tests/integration/serverLifecycle.test.ts
    npx vitest run tests/integration/socketFlow.test.ts

Expect all tests to pass and Vitest to exit without open-handle warnings. Commit only server/shared integration files:

    git add src/server/rooms src/server/network tests/integration/socketFlow.test.ts tests/integration/serverLifecycle.test.ts
    git commit -m "feat: connect FFA combat rooms"

### Task 5: Client network/store and React flows

**Files:** Rewrite/adapt `src/client/network/GameClient.ts` and test, `src/client/state/gameStore.ts`, `useGameStore.ts`, and test; modify `App.tsx`/test, `LandingScreen.tsx`/test, `LobbyScreen.tsx`/test, `TopBar.tsx`; create production `ConnectionOverlay.tsx` and `ResultScreen.tsx` for the already-started tests; modify CSS only enough to keep tests readable, leaving final polish to Task 8.

**Interfaces consumed:** revised socket/model types. **Interfaces produced:** revised `GameClient`, `GameStore`, `createArenaBridge()`, landing/lobby/result actions, and canonical screen state.

**Step 1 — rewrite tests to the new UX.** Preserve the existing red landing tests that click empty/incomplete actions so typed validation is visible. Adapt the interrupted store race and duplicate-welcome tests to chassis/FFA state. Add tests for `setChassis`, ready reset, result ranking, `NO_CONTEST` toast/lobby transition, authoritative reconnect countdown, sound setting, result-ready/rematch, and all subscription disposal. `LobbyScreen` must render four chassis silhouette buttons and no team columns.

**Step 2 — prove RED.** Run:

    npx vitest run src/client/network src/client/state src/client/App.test.tsx src/client/ui

Expect missing chassis methods/components and legacy team fixture failures.

**Step 3 — implement typed client state.** Revise `GameClient` methods to include:

    setChassis(chassis: Chassis): Promise<Ack<null>>;
    setReady(ready: boolean): Promise<Ack<null>>;
    startMatch(): Promise<Ack<null>>;
    sendInput(frame: InputFrame): void;
    setResultReady(ready: boolean): Promise<Ack<null>>;
    returnToLobby(): Promise<Ack<null>>;

`gameStore.ts` keeps one canonical room/match snapshot, deduplicates welcome side effects, defers exactly one resume until pending acknowledgements settle, exposes match/event subscriptions, computes reconnect remaining time locally from authoritative published duration without inventing expiry fields, and maps `NO_CONTEST` to a Turkish toast before lobby. `LandingScreen` leaves actions clickable and delegates raw input to the store's typed validation. `LobbyScreen` selects chassis and ready state. `ResultScreen` ranks by knockouts, fewer falls, landed hits, then join order. `ConnectionOverlay` preserves the last game frame and shows countdown/retry state.

**Step 4 — prove React GREEN and remove team language.** Run:

    npx vitest run src/client/network src/client/state src/client/App.test.tsx src/client/ui
    rg -n "CAMGÖBEĞİ|KEHRİBAR|Takım|setTeam|lobby:team|deliveries|tackles" src/client

Focused tests pass and legacy runtime copy/search results are empty. Commit:

    git add src/client/network src/client/state src/client/App.tsx src/client/App.test.tsx src/client/ui src/client/styles
    git commit -m "feat: add Neon Knockout room flows"

### Task 6: Phaser mount, bridge, input, prediction, and teardown

**Files:** Pin Phaser in `package.json`/`package-lock.json`; create the Phaser/bridge files listed in Target File Map and focused tests; rewrite `src/client/game/prediction.ts`/test; replace `GameCanvas` use in `App.tsx`; delete `GameCanvas.tsx`/test, `renderer.ts`/test, and `keyboard.ts`/test after green replacement tests.

**Interfaces consumed:** `GameStore`, combat snapshots/events, shared kinematics. **Interfaces produced:** `GamePresentationBridge`, `PhaserArena`, `createNeonGame()`, `ArenaInput`, `PredictionBuffer`, `SnapshotTimeline`, `BootScene`, and `ArenaScene`.

**Step 1 — install exact dependency and write lifecycle/input/prediction failures.** Run:

    npm install --save-exact phaser@4.2.1

Change package name to `neon-knockout`. Tests inject a fake game factory so jsdom never requires WebGL. Assert exactly one game per mount, `destroy(true)` on unmount, no duplicate bridge listeners after rerender, context menu suppression only on the arena, release on blur/visibility/shutdown, normalized pointer aim, 60 Hz input cap, local movement/action-start prediction, 70 ms remote interpolation, and no predicted hit/score.

**Step 2 — prove RED.** Run:

    npx vitest run src/client/game

Expect missing bridge/Phaser modules and old Canvas fixtures to fail.

**Step 3 — implement the integration seam.** Define:

    export interface GamePresentationBridge {
      getSnapshot(): MatchSnapshot | null;
      subscribeSnapshot(listener: (snapshot: MatchSnapshot) => void): () => void;
      subscribeEvent(listener: (event: GameEvent) => void): () => void;
      subscribeMuted(listener: (muted: boolean) => void): () => void;
      sendInput(frame: InputFrame): void;
    }
    export type NeonGameFactory = (
      parent: HTMLElement,
      bridge: GamePresentationBridge,
      options?: Readonly<{ reducedMotion?: boolean }>
    ) => Pick<Phaser.Game, 'destroy'>;

`PhaserArena.tsx` owns a parent div and one game instance. `createNeonGame()` uses `Phaser.AUTO`, 1280×720 logical size, `Phaser.Scale.FIT`, `CENTER_BOTH`, capped DPR-compatible CSS, `BootScene`, and `ArenaScene`. `ArenaInput` samples Phaser keyboard/pointer state, projects pointer position through the main camera, retains previous facing for near-zero aim, and clears all held buttons on lifecycle loss. Keep Socket.IO out of every scene.

Rewrite prediction around `advanceKinematics()` and canonical action state. `PredictionBuffer` replays unacknowledged input for position/velocity/facing only; the scene may start the local attack animation instantly but waits for `HIT`/`KNOCKOUT`. `SnapshotTimeline` interpolates remote containers at 70 ms and snaps only above one named tested threshold.

**Step 4 — prove Phaser seam GREEN, then delete Canvas.** Run:

    npx vitest run src/client/game src/client/App.test.tsx
    npm run typecheck

After these pass, remove the old Canvas/renderer/keyboard files with `apply_patch`, rerun the same command, and verify:

    rg -n "GameCanvas|renderFrame|AuthoritativeParticles|KeyboardController|carriedCore" src

The search returns no runtime hits. Commit dependency, lockfile, new Phaser files, rewritten prediction/App, and deletions:

    git add package.json package-lock.json src/client/game src/client/App.tsx src/client/App.test.tsx
    git commit -m "feat: render matches with Phaser"

## Milestone 3: The Game Feels Authored, Not Merely Functional

Tasks 7–8 replace all temporary presentation with final fighter identity, continuous animation, impact feedback, original audio, a compact HUD, responsive states, and visual quality gates. At the end, a normal hit is obvious without reading the HUD and a knockout returns control before the player feels removed from play.

### Task 7: Fighter assets and continuous animation

**Files:** Create four-part SVG sets under `public/assets/fighters/{rift,bastion,pulse,wraith}/`; optionally store one reviewed concept sheet under `docs/design/concepts/`; create `fighterManifest.ts`, `FighterView.ts`, `animationPlan.ts`/test, and `AnimationDirector.ts`/test; extend `BootScene` and `ArenaScene`.

**Interfaces consumed:** chassis/accent/action state, Phaser scene. **Interfaces produced:** `FIGHTER_MANIFEST`, `createFighterView()`, `animationPlanFor()`, and `AnimationDirector.apply()`.

**Step 1 — establish a visual contract and red animation tests.** If using image generation, first load the installed `imagegen` skill and generate one four-character top-down concept sheet with this exact intent: “four original neon mech gladiators, RIFT narrow blade duelist, BASTION broad shield shoulders, PULSE triangular jet fins, WRAITH crescent hollow core, dark graphite materials, transparent or plain neutral concept background, strong readable silhouettes at 64 pixels, no logos, no text, no copyrighted characters.” Inspect the result; it is reference only, never ship a baked background.

Write pure animation-plan tests proving idle/move blend ≤80 ms, no idle reset between combo steps, elapsed-millisecond timing, next-frame local anticipation, 700 ms knockout-to-control, 180 ms reconnect entry, protection cancellation pose, state continuity when a duplicate snapshot arrives, and reduced-motion variants.

**Step 2 — prove RED.** Run:

    npx vitest run src/client/game/phaser/animationPlan.test.ts src/client/game/phaser/AnimationDirector.test.ts

Expect missing plan/director and asset manifest failures.

**Step 3 — create final layered assets and animator.** Each chassis directory contains `body.svg`, `left-arm.svg`, `right-arm.svg`, and `core.svg`, all with `viewBox="0 0 128 128"`, transparent backgrounds, no embedded raster, and chassis-specific paths. Use graphite base shapes plus `currentColor`-compatible or neutral emissive masks that Phaser tints with the player's accent. The manifest is exact:

    export const FIGHTER_MANIFEST: Readonly<Record<Chassis, Readonly<{
      body: string;
      leftArm: string;
      rightArm: string;
      core: string;
      scale: number;
    }>>>;

`FighterView` creates a container with shadow, limbs, body, core, name, overload label, and local under-ring. `animationPlanFor(state, reducedMotion)` returns elapsed-ms keyframes for body position/rotation/scale, both arm angles, core scale/alpha, and trail intensity. `AnimationDirector.apply(player, view, nowMs)` changes plans only when canonical/predicted action state changes and preserves normalized progress for duplicate snapshots. Locomotion and idle loop independently from container interpolation.

**Step 4 — validate assets and animation GREEN.** Run focused tests, then validate SVG structure and production loading:

    npx vitest run src/client/game/phaser/animationPlan.test.ts src/client/game/phaser/AnimationDirector.test.ts
    npm run build:client

Open every SVG or a generated contact sheet and reject primitive circle-plus-vane bodies, clipping, opaque backgrounds, or indistinguishable silhouettes. Commit:

    git add public/assets/fighters docs/design/concepts src/client/game/phaser
    git commit -m "feat: add animated fighter chassis"

### Task 8: Impact, audio, HUD, reconnect, and responsive polish

**Files:** Create `ImpactFx.ts`/test, `GameAudio.ts`/test, `scripts/generate-audio.mjs`, generated audio assets; extend `ArenaScene`; rewrite the interrupted `audio.test.ts`; modify `App.tsx`, `TopBar.tsx`, new `MatchHud.tsx`/test, `ConnectionOverlay.tsx`, `ResultScreen.tsx`, and CSS token/layout/game files.

**Interfaces consumed:** authoritative events and fighter views. **Interfaces produced:** `ImpactFx.ingest()`, `GameAudio.playEvent()`, `MatchHud`, and final visual states.

**Step 1 — write red effect/audio/HUD tests.** Use fake Phaser adapters rather than starting WebGL. Assert each `eventId` is consumed once; `HIT` produces target flash/pose, directional particles, overload pulse, and camera nudge unless reduced motion; `KNOCKOUT` adds burst/edge/score feedback; mute stops every sound immediately and persists; first gesture unlocks audio; teardown removes emitters/sounds/listeners; HUD contains only phase/time, compact ranking, local overload, dash/charge, connection, and controls; 900×600 is supported while smaller viewports show the explicit warning.

**Step 2 — prove RED.** Run:

    npx vitest run src/client/game/phaser/ImpactFx.test.ts src/client/game/phaser/GameAudio.test.ts src/client/ui src/client/App.test.tsx

Expect missing directors/HUD and old audio cue names to fail.

**Step 3 — implement feedback and final UI.** `ImpactFx.ingest(event, snapshot)` deduplicates by event ID and drives Phaser camera shake/nudge, tweened sprite flash/hold, particles, trails, and announcer text without pausing server time. `GameAudio` loads generated short cues through Phaser Sound, unlocks after one user gesture, applies deterministic pitch variation derived from `eventId`, and owns disposal.

Create `scripts/generate-audio.mjs` as a deterministic PCM WAV writer for `quick`, `heavy-charge`, `heavy-release`, `hit`, `dash`, `knockout`, `respawn`, `countdown`, `warning`, and `victory`; add `assets:audio` and run it once. Do not depend on remote media or copyrighted samples.

Replace core/team HUD and copy. Use eight accent swatches plus names, not color alone. Landing errors remain adjacent to fields. Lobby chassis buttons show actual silhouettes. Reconnect overlay uses authoritative remaining duration. Result rankings follow the spec. CSS covers default, hover, focus-visible, active, disabled, loading, error, ready, reconnect, and success states at all four target viewports.

**Step 4 — prove presentation GREEN and scan craft regressions.** Run:

    npm run assets:audio
    npx vitest run src/client/game src/client/ui src/client/App.test.tsx
    npm run build:client

Then run the installed Impeccable detector once against the changed client targets and resolve only findings that trace to the approved UI scope. Visually inspect fighter and arena output in a production build; do not accept tests alone. Commit:

    git add scripts package.json package-lock.json public/assets src/client
    git commit -m "feat: deliver knockout combat feedback"

## Milestone 4: The Same Commit Is Proven and Published

Tasks 9–10 prove real multi-client behavior, performance, cleanup, instructions, LAN reachability, supported viewport quality, and remote publication. No completion claim is made before every acceptance signal refers to the same commit.

### Task 9: Load, E2E, performance, and README

**Files:** Create `tests/load/eightClients.test.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/knockout.spec.ts`, and `tests/e2e/performance.spec.ts`; modify `playwright.config.ts`, `vitest.config.ts`, `package.json`; create `README.md`; adapt integration helpers as needed without adding production test routes.

**Interfaces consumed:** `GameServer`, private harness, public Socket.IO protocol, production client. **Interfaces produced:** reproducible `test:load`, `test:e2e`, and host/join instructions.

**Step 1 — write the failing load/browser tests.** The Node load test starts `createGameServer({ host: '127.0.0.1', port: 0, enableTestHarness: true, clientDirectory: false })`, creates eight websocket-only clients, joins one room, selects chassis, readies, starts, sends legal 60 Hz input for 10 seconds, and asserts at least 250 snapshots per client, zero unexpected errors, responsive health, stable debug-room counts, and explicit client/listener/server cleanup. Add `// @vitest-environment node` at the file top.

Playwright fixtures build once, start an ephemeral production `GameServer` in-process, and expose its origin/harness only to the test process. Two isolated contexts must create/join/select/ready/start, move visibly, aim and land one real quick hit, force five knockouts only to reach results, rematch, disconnect/resume the same identity without a fall, and record no page or console errors. Performance test samples `requestAnimationFrame` during an eight-fighter scripted event burst and asserts median ≥58 FPS and p95 frame duration <25 ms.

**Step 2 — prove RED.** Run:

    npx vitest run tests/load/eightClients.test.ts
    npm run test:e2e

Expect missing load files/scripts/fixtures or unmet snapshot/combat selectors.

**Step 3 — finish harness-safe automation and docs.** Add scripts:

    "test:load": "vitest run tests/load/eightClients.test.ts",
    "test:e2e": "npm run build && playwright test",
    "verify": "npm run lint && npm run typecheck && npm test && npm run test:load && npm run build"

`README.md` starts with the exact host sequence `npm ci` then `npm run lan`, explains localhost versus printed private LAN URL, name and four-character room code, firewall guidance, controls, reconnect behavior, Node 20 requirement, macOS/Windows/Linux notes, health probe, troubleshooting, and every verification command. Do not claim WAN support.

**Step 4 — prove automation GREEN and repeat cleanup.** Run:

    npm run test:load
    npm run test:load
    npm run test:e2e
    npm run verify

All commands exit zero. The repeated load run emits no open-handle warning. Commit:

    git add tests playwright.config.ts vitest.config.ts package.json package-lock.json README.md
    git commit -m "test: verify multiplayer delivery"

### Task 10: Completion audit, live acceptance, and public release

**Files:** Create `docs/verification/2026-08-28-neon-knockout-acceptance.md`; modify only defects found by acceptance; update this ExecPlan living sections; merge/push after a clean final review.

**Interfaces consumed:** every acceptance gate. **Produces:** one verified local/remote `main` SHA and public playable source.

**Step 1 — clean-install and automated completion audit.** Stop only the known old preview process on port 4173 after identifying it. In the implementation worktree run:

    npm ci
    npm run verify
    npm run test:e2e
    npm run test:load
    npm run test:load

Record exact counts, durations, and commit SHA in the acceptance document. Search source/docs/assets for legacy runtime concepts and placeholders:

    rg -n "Neon Relay|CYAN|AMBER|core|reactor|delivery|tackle|TODO|TBD|placeholder" src public README.md

Only intentionally historical documentation references may remain.

**Step 2 — real production and LAN acceptance.** Start `npm run lan`, capture its localhost and RFC1918 URL, and prove:

    curl --fail http://127.0.0.1:4173/health
    curl --fail http://<printed-private-ip>:4173/health

Use two real browser sessions against the production build to complete create/join/chassis/ready/start/real hit/knockout/result/rematch and one forced disconnect/resume. Inspect landing, lobby, match, contraction warning, reconnect overlay, and results at 1440×900, 1280×720, 1024×768, and 900×600. Save representative screenshots under `docs/verification/screenshots/`. Verify mute, focus order, field errors, reduced motion, no console errors, animation continuity, 700 ms control return, and readable eight-player effects.

**Step 3 — independent review and defect loop.** Dispatch a spec-compliance reviewer and a code-quality/security reviewer against the final diff. Apply valid findings with focused regression tests, rerun affected suites, then rerun `npm run verify`, `npm run test:e2e`, and one final load test. Update the plan's `Surprises & Discoveries`, `Decision Log`, `Progress`, and `Outcomes & Retrospective`. Commit the acceptance evidence and fixes:

    git add docs/superpowers/plans/2026-08-28-neon-knockout.md docs/verification src tests public README.md package.json package-lock.json
    git commit -m "chore: complete Neon Knockout acceptance"

**Step 4 — integrate and publish without overwriting user work.** Ensure the implementation worktree is clean. In `/Users/serkances/dev/game`, inspect `git status --short`; if unrelated user changes exist, preserve them and do not merge across them. Otherwise run:

    git switch main
    git merge --ff-only feat/neon-relay-game
    git push origin main
    git rev-parse HEAD
    git ls-remote origin refs/heads/main

The two printed SHAs must match exactly. Verify the GitHub repository is public and its default branch is reachable. Do not mark the goal complete until the remote equality, live acceptance, assets, tests, and README are all proven against that SHA.

## Concrete Steps

Every task follows one red-green-review-commit loop. Run commands from `/Users/serkances/dev/game/.worktrees/neon-relay-implementation` unless Task 10 explicitly switches to the root checkout. A focused RED run must fail for the expected missing behavior, not because of syntax, stale fixtures, or environment setup. A GREEN run must include the focused files plus the nearest existing integration surface. Update `Progress` immediately after each commit with UTC timestamp and SHA; append unexpected evidence to `Surprises & Discoveries` before proceeding.

The broad command ladder is:

    npm run lint
    npm run typecheck
    npm test
    npm run test:load
    npm run build
    npm run test:e2e

Expected final signals are zero lint/type errors, every Vitest suite passing, at least 250 snapshots for each of eight load clients over ten seconds, a successful Vite and server bundle, all Playwright scenarios passing without console errors, median ≥58 FPS and p95 frame duration <25 ms in the scripted burst, and HTTP 200 health through both localhost and one printed private address.

## Validation and Acceptance

The user-visible acceptance is a fast match, not merely green code. A new player can create a room with a visible validation error if the name is missing; a friend joins with the four-character code; both select visually different fighters and ready; the host starts; local movement and attack anticipation respond on the next rendered frame; confirmed hits visibly displace, flash, spark, shake, sound, and update overload; quick combo and heavy release are readable; knockout control returns within 700 ms; attacking cancels spawn protection; the arena contracts late in the round; the first to five wins; results/rematch work; and disconnect/resume adds no fall or knockout.

The visual acceptance rejects any final circle-plus-vane fighter, static sliding sprite, hard idle snap between combo steps, opaque/baked asset background, unreadable accent, clipped HUD, silent confirmed hit when unmuted, camera motion under reduced-motion, or duplicated primary action. The technical acceptance rejects any production cheat route, client-authored hit/score, leaked listener/timer, mutable debug state, non-monotonic input acceptance, open handle, or local-only completion claim.

## Idempotence and Recovery

All test servers use port `0` and explicit `finally` cleanup, so failed runs can be repeated. Asset generation is deterministic and overwrites only the named generated WAV files. Do not use `git reset --hard`, `git checkout --`, or recursive deletion. The six existing uncommitted superseded test drafts belong to this agent's interrupted work: adapt or replace them with `apply_patch` inside their owning task, and stage them only when the new behavior passes.

If Phaser cannot initialize in jsdom, do not add browser globals to production code; keep unit tests on injected factories and pure animation/effect planners, and prove the actual renderer in Playwright. If a build changes or removes `dist/` while an old preview is serving it, stop the identified preview first and restart after the build. If the root checkout cannot fast-forward at release, inspect both histories and preserve user changes; never force-push or reset. If the private LAN address is unavailable, record that live LAN acceptance is incomplete rather than substituting localhost.

## Artifacts and Notes

The authoritative design is `docs/superpowers/specs/2026-08-28-neon-knockout-design.md`. The superseded design remains only as historical evidence. The public remote is `git@github.com:reitenji/neon-relay.git`. The current design commits are `4087655` and `2b4e909`. Acceptance evidence belongs under `docs/verification/` and must identify the exact tested commit, commands, viewport, local URL, LAN URL, browser flow, and result.

## Interfaces and Dependencies

Pin `phaser` to exactly `4.2.1`; retain existing React, Express, Socket.IO, Zod, and test dependencies unless a measured gap requires otherwise. Do not add Matter, Pixi, Howler, a state-management library, a CSS framework, a database, or an asset runtime. Phaser owns the render/game-object lifecycle; React owns DOM lifecycle; `GamePresentationBridge` connects them; Socket.IO remains behind `GameClient`; the room manager owns time/session orchestration; and the pure game domain owns all authoritative rules.

The stable cross-task functions are `advanceKinematics()`, `platformAt()`, `createMatchState()`, `stepMatch()`, `snapshotMatch()`, `setPlayerConnected()`, `forceKnockout()`, `RoomManager.setChassis()`, `RoomManager.applyInput()`, `RoomManager.debugRoom()`, `createSocketGameClient()`, `createGameStore()`, `createArenaBridge()`, `createNeonGame()`, `createFighterView()`, `animationPlanFor()`, `AnimationDirector.apply()`, `ImpactFx.ingest()`, and `GameAudio.playEvent()`. If implementation discovers a necessary signature change, update this plan's file map, task interfaces, Decision Log, and every downstream reference before committing code.

## Plan Revision Note

2026-08-28: Created this plan after the user approved the Phaser-based Neon Knockout redesign and explicitly requested faster delivery. The plan chooses subagent-driven execution, ten reviewer-sized vertical slices, short 700 ms knockouts, no disconnect penalty, and measurable animation continuity so speed does not reduce the requested gameplay quality.
