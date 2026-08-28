# Neon Knockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this file in accordance with `/Users/serkances/.codex/PLANS.md`.

**Goal:** Replace the rejected relay game with a polished, fast, combat-first LAN brawler that 2–8 desktop players can join from browsers and enjoy immediately.

**Architecture:** The existing Node.js and Socket.IO foundations stay, but the shared model, authoritative simulation, room lifecycle, and client presentation all pivot from team core-delivery to free-for-all melee combat. React continues to own lobby and shell UI, while Phaser 4.2.1 becomes the arena runtime through a narrow presentation bridge that consumes canonical snapshots and emits normalized local inputs.

**Tech Stack:** Node.js 20+, TypeScript, React, Vite, Express, Socket.IO, Zod, Phaser 4.2.1, Vitest, Testing Library, Playwright, ESLint, tsup

**Spec:** `docs/superpowers/specs/2026-08-28-neon-knockout-design.md`

## Global Constraints

- Desktop and laptop browsers only; no mobile or touch path is added.
- The game is 2–8 player free-for-all only. Old team, core, reactor, delivery, and goal rules are removed rather than preserved as a mode.
- Server simulation remains authoritative for movement, attacks, hits, overload, knockouts, respawns, arena contraction, scoring, and result transitions.
- React owns non-game UI; Phaser 4.2.1 owns the arena scene, effects, animation, camera, and audio playback.
- Product copy stays Turkish. Source identifiers stay English.
- Rooms remain local-memory only, use four-character join codes, support resume tokens, and require no cloud services.
- The match contract is fixed by the spec: 120 seconds, first to 5, 700 ms knockout-to-control, 650 ms respawn protection, no negative scoring or escalating respawn penalties.
- Animation timing is elapsed-time based, not frame-count based. Idle/move transitions blend in 80 ms, combo chaining must not snap back to idle between steps, and authoritative corrections must not rigid-slide a pose.
- Existing uncommitted test drafts in `src/client/state/gameStore.test.ts`, `src/client/ui/LandingScreen.test.tsx`, `src/server/rooms/roomManager.test.ts`, `src/client/game/audio.test.ts`, `src/client/ui/ConnectionOverlay.test.tsx`, and `src/client/ui/ResultScreen.test.tsx` are part of this branch context. Update or replace them deliberately; do not discard them blindly.

## Purpose / Big Picture

After this change, one friend can run the Node host and everyone else on the same LAN can join from a browser, pick a mech chassis, ready up, and play a fast knockout brawler with readable impact, shrinking arena pressure, smooth animation, and immediate rematches. The visible proof is a real local match where two or more browser sessions create or join a room, select chassis, start a round, exchange hits and knockouts, see a result screen, and rematch without page reloads or broken reconnect behavior.

## Progress

- [x] (2026-08-28 00:00Z) Approved redesign spec exists at `docs/superpowers/specs/2026-08-28-neon-knockout-design.md`.
- [x] (2026-08-28 00:00Z) Current code paths traced: React screen router, `gameStore`, Socket.IO client, Canvas renderer, room manager, and server simulation all still encode relay/team mechanics.
- [ ] Replace shared model and protocol with free-for-all combat types, chassis, accent, and result structures.
- [ ] Replace the authoritative simulation with deterministic combat, knockout, respawn, and shrinking-platform rules.
- [ ] Replace room lifecycle, socket handlers, and integration tests for chassis select, rematch, resume, pause, and no-contest rules.
- [ ] Replace the Canvas arena with a Phaser mount, presentation bridge, fighter views, effects, animation, and audio.
- [ ] Replace lobby, HUD, reconnect overlay, and result UI semantics and styling to match Neon Knockout.
- [ ] Run full verification, README updates, live LAN proof, and final Git/GitHub publication.

## Surprises & Discoveries

- Observation: The old game loop is spread across shared types, server simulation, room rules, store selectors, HUD text, and renderer layer names, so the redesign is a true replacement rather than a local fix.
  Evidence: `src/shared/model.ts` still exposes `Team`, `MatchCore`, and score-by-team; `src/server/game/simulation.ts` still emits `PICKUP`, `DROP`, `TACKLE`, and `SCORE`; `src/client/game/GameCanvas.tsx` still renders `ÇEKİRDEK` HUD state.
- Observation: The current store already has useful separation between React UI, connection/session state, snapshot subscriptions, and event subscriptions, which can be preserved while swapping match semantics.
  Evidence: `src/client/state/gameStore.ts` already exposes `subscribeMatch`, `subscribeGameEvent`, `sendInput`, and derived `screenForRoom`.

## Decision Log

- Decision: Write a new ExecPlan instead of mutating the old relay implementation plan.
  Rationale: The approved spec explicitly supersedes the prior design and removes the old game loop rather than extending it.
  Date/Author: 2026-08-28 / Codex
- Decision: Keep the existing isolated worktree and public repository continuity, but rename the product in UI, docs, and metadata to Neon Knockout.
  Rationale: The user already authorized public GitHub publication and the spec allows the `neon-relay` repository URL to remain while the shipped product is renamed.
  Date/Author: 2026-08-28 / Codex
- Decision: Preserve the existing `gameStore` external-store shape and typed `GameClient` wrapper, but replace their payloads and actions instead of introducing a new state library.
  Rationale: The current separation is sufficient, already tested, and keeps the refactor surgical.
  Date/Author: 2026-08-28 / Codex

## Outcomes & Retrospective

- Pending implementation.

## Context and Orientation

The current browser shell begins in [src/client/App.tsx](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/client/App.tsx), which routes among landing, lobby, match, and a placeholder result screen. The app state comes from [src/client/state/gameStore.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/client/state/gameStore.ts), which subscribes to `room:state`, `match:started`, `match:snapshot`, and `match:event`, stores the session resume token, and exposes actions for create, join, team switch, ready, and match start.

The current network client is [src/client/network/GameClient.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/client/network/GameClient.ts). It wraps Socket.IO acknowledgements cleanly and should remain the single client transport layer. The existing arena runtime is [src/client/game/GameCanvas.tsx](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/client/game/GameCanvas.tsx), which currently mounts a custom Canvas renderer via [src/client/game/renderer.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/client/game/renderer.ts), a keyboard sampler, and snapshot prediction code.

On the server, [src/server/rooms/roomManager.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/server/rooms/roomManager.ts) owns room creation, join, resume, host migration, ready/start gating, disconnect reservations, and the simulation loop. It currently enforces team balance and remaps room state to team-based players. The authoritative simulation lives in [src/server/game/simulation.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/server/game/simulation.ts) and [src/server/game/state.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/server/game/state.ts); both still model core pickup, tackle, delivery, and team scoring.

The shared contract lives in [src/shared/model.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/shared/model.ts), [src/shared/constants.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/shared/constants.ts), and [src/shared/protocol.ts](/Users/serkances/dev/game/.worktrees/neon-relay-implementation/src/shared/protocol.ts). These files are the first safe place to pivot because every other subsystem consumes them.

The dirty test files listed in `git status --short` are branch-local unfinished work, not unrelated user files elsewhere in the repo. They must either be completed in place or replaced by stronger tests that cover the same UI and state concerns.

## File Structure

The refactor should converge on the following boundaries.

- `src/shared/model.ts`: free-for-all room, chassis, accent, player combat, match phase, result, and typed event payloads.
- `src/shared/constants.ts`: platform polygons, contraction timings, move/combat tuning, chassis identifiers, accent palette, and UI-readable control labels.
- `src/shared/protocol.ts`: revised Zod schemas and Socket.IO event maps, including `lobby:chassis` and richer `match:input`.
- `src/server/game/geometry.ts`: pure polygon, vector, collision, separation, knockback, and spawn-anchor helpers.
- `src/server/game/state.ts`: canonical `MatchState`, player combat state, attack-instance tracking, score/stat bookkeeping, and snapshot projection.
- `src/server/game/simulation.ts`: fixed-step rule ordering exactly as required by the spec.
- `src/server/rooms/roomManager.ts`: room membership, reservation windows, host migration, start/rematch rules, pause/no-contest behavior, and publication cadence.
- `src/server/network/socketHandlers.ts` and `src/server/network/createGameServer.ts`: payload validation and broadcast wiring only, with no combat logic.
- `src/client/network/GameClient.ts`: transport wrapper updated for new events and actions only.
- `src/client/state/gameStore.ts`: canonical room/match/result shell state, bridge subscriptions, chassis-ready/rematch actions, and user-facing errors.
- `src/client/game/`: Phaser runtime. Replace `GameCanvas.tsx` and `renderer.ts` with a mount component and focused modules:
  - `PhaserGame.tsx`: React mount/unmount of exactly one Phaser game instance.
  - `presentationBridge.ts`: typed bridge between store/network snapshots and Phaser scenes.
  - `scenes/BootScene.ts`: preload and asset validation.
  - `scenes/ArenaScene.ts`: world rendering, fighter view lifecycle, platform view, camera, and effects.
  - `input/controller.ts`: keyboard/mouse sampling, blur cleanup, and normalized combat input frames.
  - `net/prediction.ts`: local prediction, reconciliation, and interpolation tuned for the new movement model.
  - `view/fighterView.ts`, `view/platformView.ts`, `view/effects.ts`, `audio/audioBus.ts`: focused presentation responsibilities.
- `src/client/ui/`: React-owned non-game surfaces. Keep `LandingScreen.tsx`, `LobbyScreen.tsx`, `TopBar.tsx`, `ToastRegion.tsx`; add real `ConnectionOverlay.tsx` and `ResultScreen.tsx`; remove team UI and old core HUD semantics.
- `public/assets/`: original fighter textures, arena textures, UI effect sprites, and short audio cues. If generated locally, keep them original and repository-safe.

Obsolete files after migration: `src/client/game/renderer.ts` and its tests, the old team-oriented parts of `src/client/game/GameCanvas.tsx`, and any shared/server/client types or tests that still mention cores, reactors, teams, or tackles.

## Plan of Work

The work proceeds in vertical slices so the app stays runnable. Start by rewriting the shared contract because every other file depends on it. Replace `Team` and team-score-centric types with `ChassisId`, `AccentId`, `CombatInputFrame`, `RoomPlayerState`, `MatchPlayerState`, `MatchResult`, `ScoreEntry`, and typed combat events such as `HIT`, `KNOCKOUT`, `RESPAWN`, `PHASE`, and `RESULT`. Update `src/shared/protocol.ts` so the client sends `lobby:chassis`, `lobby:ready`, `match:start`, and `match:input` with movement axes, aim vector, and button states, while the server emits room state, start snapshot, periodic snapshots, and authoritative events. Rewrite the shared tests first and watch the current contract fail before writing the new types.

Next, replace the authoritative server combat domain. `src/server/game/state.ts` should describe a player in plain gameplay terms: position, velocity, facing, overload, combo step, attack phase/timers, charge duration, dash state, hitstun, respawn protection, recent attacker, score, knockouts, falls, landed hits, attempted attacks, and connection activity. `src/server/game/geometry.ts` must expose pure helpers for polygon containment, shortest edge normal, off-stage distance, circular body separation, and deterministic spawn-anchor selection. `src/server/game/simulation.ts` then implements the exact 60 Hz phase order from the spec: normalize input, advance timers, update arena contraction, start legal actions, integrate movement and knockback, separate players, resolve attack arcs, apply knockouts and respawns, and advance the match/result state. Replace the relay tests with server tests that prove combo timing, heavy-charge behavior, overload/impulse math, dash invulnerability, knockout attribution, self-falls, respawn protection cancellation, sudden death, and deterministic replay.

After the simulation is stable, adapt the room lifecycle and socket boundary. `src/server/rooms/roomManager.ts` should stop assigning teams and instead assign deterministic accent slots and default chassis by join order. Starting a match should require at least two connected players and every connected player ready. Disconnecting during a match should remove the player from active simulation immediately, preserve their score/chassis/accent/statistics for 20 seconds, and either continue the match, pause it awaiting a valid opponent resume, or resolve to `NO_CONTEST` without granting wins or losses. Rewrite `src/server/rooms/roomManager.test.ts` and the integration tests around these rules. Update `socketHandlers.ts` so payload validation matches the new schemas and invalid aim or stale input sequences are rejected safely. Keep the real Socket.IO integration harness and load-smoke tests, but pivot them to chassis-ready-start-combat-rematch flow.

Once the shared/server path is green, replace the browser arena runtime. Remove the custom Canvas renderer path and mount Phaser from React through `PhaserGame.tsx`. The `presentationBridge.ts` module becomes the only seam between store/network state and Phaser. It receives canonical snapshots and events from `gameStore`, exposes the latest room/match presentation state to scenes, and accepts normalized local input frames back to `store.sendInput`. `BootScene` loads assets and surfaces recoverable failures. `ArenaScene` owns fighter containers, animation state machines, platform rendering, contraction warning, particles, camera response, and audio triggers from authoritative events. Keep local movement and attack-start prediction immediate, but ensure only the server can confirm hits, overload, knockouts, or score changes. The Phaser unit tests should prove a single mount, clean teardown, fighter view add/update/remove behavior, and event-triggered effect/audio contracts.

Then refresh the React UI around the new game. `LandingScreen.tsx` must show validation errors even when the user attempts actions from an incomplete form, rather than silently disabling them. `LobbyScreen.tsx` should replace team panels with player cards, chassis selectors, accent markers, ready state, and host controls. `TopBar.tsx`, `ConnectionOverlay.tsx`, and the match HUD should describe room code, connection state, timer, score ranking, local overload, dash/charge state, and controls hints, with no core-carry UI. `ResultScreen.tsx` should rank players by score, then fewer falls, then more landed hits, then join order, and expose `Tekrar Hazır` and host-only `Lobiye Dön`. Update CSS tokens and layout with a brighter, more readable arena shell, but keep the non-game controls keyboard reachable and visibly focused.

Finish by updating the end-to-end and live-delivery path. Replace README copy, game name, scripts if needed, and testing instructions so `npm run verify`, `npm run test:e2e`, and `npm run lan` still work. Run a real local browser flow from at least two sessions, prove `/health` on localhost and one LAN address, and only then prepare the public GitHub push.

## Concrete Steps

### Task 1: Shared Contract Replacement

**Files:** `src/shared/model.ts`, `src/shared/constants.ts`, `src/shared/protocol.ts`, `src/shared/names.ts`, `src/shared/*.test.ts`, `package.json`

**Produces:** `ChassisId`, `AccentId`, `CombatInputFrame`, `RoomState`, `MatchSnapshot`, `GameEvent`, `MatchResult`, `ClientToServerEvents`, `ServerToClientEvents`, updated `GAME` and arena constants

- [ ] Write failing shared tests for chassis selection, input schema validation, room code and name normalization, and typed combat events.
- [ ] Add `phaser@4.2.1` to `package.json` and update package lock.
- [ ] Replace shared types and constants to match the spec exactly, removing core/team-only artifacts.
- [ ] Run `npx vitest run src/shared` and `npm run typecheck`; keep iterating until green.
- [ ] Commit with a message equivalent to `refactor: replace relay shared contract with knockout model`.

### Task 2: Deterministic Combat Simulation

**Files:** `src/server/game/state.ts`, `src/server/game/geometry.ts`, `src/server/game/simulation.ts`, `src/server/game/*.test.ts`

**Consumes:** updated shared model and constants

**Produces:** `createMatchState`, `snapshotMatch`, `stepMatch`, deterministic attack IDs, respawn and contraction helpers, replay-safe event ordering

- [ ] Write failing server tests for movement acceleration/drag, dash rules, combo timing, heavy charge/release, hit detection, overload knockback scaling, knockout attribution, self-fall, respawn protection, and sudden death.
- [ ] Replace relay state and simulation with the combat model in the spec.
- [ ] Add a deterministic replay test that runs the same seed and input stream twice and expects identical snapshots/events.
- [ ] Run `npx vitest run src/server/game` until fully green.
- [ ] Commit with a message equivalent to `feat: add authoritative neon knockout combat simulation`.

### Task 3: Room Lifecycle and Network Integration

**Files:** `src/server/rooms/roomManager.ts`, `src/server/rooms/roomManager.test.ts`, `src/server/network/socketHandlers.ts`, `src/server/network/createGameServer.ts`, `src/client/network/GameClient.ts`, `src/client/network/GameClient.test.ts`, `tests/integration/*`, `tests/load/*`

**Consumes:** new shared protocol and combat simulation

**Produces:** chassis-ready-start-rematch socket flow, pause/resume/no-contest handling, typed server errors, and updated load/integration proof

- [ ] Write failing tests for chassis selection resetting ready, host migration, reconnect grace, paused match resume, no-contest cleanup, invalid payload rejection, and stale input handling.
- [ ] Replace room rules and socket wiring to the new protocol while preserving the existing create/join/resume foundation.
- [ ] Update or create integration/load tests so multiple real Socket.IO clients can complete a knockout match lifecycle and rematch.
- [ ] Run focused server/integration tests, then run the eight-client smoke test three times.
- [ ] Commit with a message equivalent to `feat: wire neon knockout rooms and socket flow`.

### Task 4: Phaser Arena Runtime

**Files:** `src/client/game/PhaserGame.tsx`, `src/client/game/presentationBridge.ts`, `src/client/game/scenes/BootScene.ts`, `src/client/game/scenes/ArenaScene.ts`, `src/client/game/input/controller.ts`, `src/client/game/net/prediction.ts`, `src/client/game/view/*`, `src/client/game/audio/*`, `src/client/game/*.test.ts`, `public/assets/*`, remove or replace `src/client/game/GameCanvas.tsx` and `src/client/game/renderer.ts`

**Consumes:** store snapshot/event subscriptions and `store.sendInput`

**Produces:** single Phaser mount, authoritative event presentation, local prediction, animation blending, audio mute support, reduced-motion handling

- [ ] Write failing client tests for single Phaser mount, clean teardown, bridge snapshot flow, fighter view lifecycle, and event-driven effects/audio.
- [ ] Replace the Canvas runtime with the Phaser bridge and focused presentation modules.
- [ ] Add or import original fighter and arena assets plus short audio cues, ensuring all assets are repo-safe and transparent.
- [ ] Verify idle/move blend, combo chaining, dash, knockout, and respawn transitions in both automated tests and a manual browser run.
- [ ] Commit with a message equivalent to `feat: add phaser arena presentation for neon knockout`.

### Task 5: React UI and Styling Refresh

**Files:** `src/client/App.tsx`, `src/client/state/gameStore.ts`, `src/client/state/gameStore.test.ts`, `src/client/ui/LandingScreen.tsx`, `src/client/ui/LobbyScreen.tsx`, `src/client/ui/TopBar.tsx`, `src/client/ui/ConnectionOverlay.tsx`, `src/client/ui/ResultScreen.tsx`, `src/client/ui/*.test.tsx`, `src/client/styles/*.css`

**Consumes:** updated room and match state plus bridge-friendly HUD data

**Produces:** visible validation, chassis lobby, reconnect overlay, proper result screen, match HUD, and polished desktop styling

- [ ] Write failing component and store tests that cover visible landing validation, chassis ready flow, reconnect overlay, result ranking, and sound/reduced-motion persistence.
- [ ] Replace team/core UI semantics in the store and screens with chassis, accent, score ranking, overload, dash/charge, rematch, and lobby return actions.
- [ ] Update the app shell to mount Phaser in match state and real result UI in result state.
- [ ] Run `npx vitest run src/client` until green, including the previously dirty draft tests now brought into the final contract.
- [ ] Commit with a message equivalent to `feat: refresh neon knockout ui and hud`.

### Task 6: End-to-End Verification and Delivery

**Files:** `README.md`, `playwright.config.ts`, `tests/e2e/*`, any verification helpers, final plan updates

**Consumes:** completed app

**Produces:** verified browser flow, README host/join instructions, final branch ready for push

- [ ] Update README name, controls, host/join steps, reconnect expectations, and troubleshooting to match the shipped game.
- [ ] Update Playwright tests for create, join, chassis select, ready, start, movement, attack exchange, forced result, rematch, and reconnect flow.
- [ ] Run `npm run verify`, `npm run test:e2e`, and a real `npm run lan` session with `/health` checks on localhost and one LAN address.
- [ ] Update this plan’s `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` with actual results and evidence.
- [ ] Prepare non-destructive Git status, final commits, and public GitHub push only after all checks are green.

## Validation and Acceptance

The final acceptance bar is behavioral, not structural. A successful implementation means:

- `npm run verify` passes from `/Users/serkances/dev/game/.worktrees/neon-relay-implementation` with no lint, type, unit, or build failures.
- `npm run test:e2e` proves two isolated browser sessions can create or join a room, choose chassis, ready, start, move, attack, see a knockout or forced-result path, reach results, and rematch.
- A manual local run on `http://localhost:4173` shows smooth fighter animation, readable hit feedback, shrinking arena warning, correct score rules, fast respawns without punitive delays, and a real reconnect overlay/path.
- `/health` returns HTTP 200 on localhost and a discovered private LAN address while the production build is running.
- No shipped UI, test, or runtime artifact still references core delivery, team columns, reactors, or old relay terminology except where historical repository names remain intentionally unchanged.

## Idempotence and Recovery

All code and test steps are repeatable. If a slice fails midway, restore confidence by rerunning the focused failing test first, not by reverting unrelated branch changes. When replacing old modules, delete obsolete code only after the new path is green in focused tests. Asset or Phaser boot failures must degrade to a recoverable user-visible state rather than a blank screen. Public push remains the only externally visible side effect and happens after verification.

## Artifacts and Notes

Useful checkpoints to capture while executing:

    git status --short --branch
    npm run verify
    npm run test:e2e
    curl -i http://127.0.0.1:4173/health

For manual verification, keep one host browser and one guest browser or incognito session. Confirm that the guest can join with the four-character room code, that both players can start after choosing chassis and readying, and that a disconnect during a live round shows the reconnect overlay without awarding a phantom knockout.

## Interfaces and Dependencies

These interfaces must exist by the time implementation finishes:

`src/shared/model.ts` should export stable discriminated types similar to:

    export type ChassisId = 'RIFT' | 'BASTION' | 'PULSE' | 'WRAITH';
    export type AccentId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    export type CombatInputFrame = Readonly<{
      seq: number;
      moveX: number;
      moveY: number;
      aimX: number;
      aimY: number;
      quick: boolean;
      heavy: boolean;
      dash: boolean;
    }>;

`src/server/game/simulation.ts` should expose:

    export function stepMatch(
      state: MatchState,
      inputs: ReadonlyMap<string, CombatInputFrame>,
      stepMs: number
    ): readonly GameEvent[];

`src/client/game/presentationBridge.ts` should define the narrow seam between React and Phaser:

    export interface GamePresentationBridge {
      getSnapshot(): PresentationSnapshot | null;
      subscribeSnapshot(listener: (snapshot: PresentationSnapshot) => void): () => void;
      subscribeEvent(listener: (event: GameEvent) => void): () => void;
      sendInput(frame: CombatInputFrame): void;
      setSceneReady(ready: boolean): void;
    }

`src/client/game/PhaserGame.tsx` should mount one Phaser instance per React match screen lifetime and destroy it on unmount.

Revision note: 2026-08-28. Created this replacement ExecPlan because the approved Neon Knockout spec supersedes the earlier relay plan and requires a full combat-first rewrite across shared, server, client, UI, and verification layers.
