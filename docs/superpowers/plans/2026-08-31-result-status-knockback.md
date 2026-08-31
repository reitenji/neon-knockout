# Result Status, Knockback, And Ping Roster Implementation Plan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current as the work moves.

If `~/.codex/PLANS.md` changes the execution standard, this document must continue to satisfy it. The current repository root for this work is `/Users/serkances/dev/game`.

## Purpose / Big Picture

After this change, accumulated damage percent will amplify knockback in a direct, readable way, so high-damage hits feel meaningfully more explosive than low-damage hits. The result screen will also keep an authoritative result roster that still shows who became ready for a rematch and who left during the result phase, instead of dropping leavers from the table entirely. During a match, the side roster will show each connected player's knockout score and measured network round-trip time.

You can see the outcome by finishing a match, marking one player ready on the result screen, having another leave, and confirming the table still shows both `Hazır` and `Ayrıldı` states while rematch logic only considers currently connected players. You can also verify combat numerically in tests by comparing the impulse at low and high overload values.

## Progress

- [x] (2026-08-31 13:05Z) Traced the authoritative knockback formula to `src/server/game/combatResolution.ts` and the result-room lifecycle to `src/server/rooms/roomManager.ts`.
- [x] (2026-08-31 14:45Z) Wrote failing tests for direct overload scaling, persisted result statuses, and ping sampling/display.
- [x] (2026-08-31 14:46Z) Implemented shared model, room-manager, Socket.IO RTT sampling, and UI changes.
- [x] (2026-08-31 14:46Z) Passed 86 focused tests, ESLint, and both TypeScript typechecks.
- [x] (2026-08-31 15:16Z) Passed the complete verification gate (47 files, 368 tests, load test, production build), four Playwright scenarios, and the production dependency audit.
- [x] (2026-08-31 15:16Z) Refreshed the LAN server and completed a two-browser live match acceptance: both ping values rendered, the roster measured 178px (14.4% of the 1232px stage), and both local and LAN probes returned HTTP 200.

## Surprises & Discoveries

- Observation: current knockback already scales with overload, but it is capped at `1.9x` because the formula is `baseImpulse * (1 + overload/maxOverload * 0.9)`.
  Evidence: `src/server/game/combatResolution.ts` in `applyHit(...)`.
- Observation: the result screen cannot show leavers because it renders `room.players`, while `leaveRoom(...)` immediately removes the player from `room.players`.
  Evidence: `src/client/ui/ResultScreen.tsx` and `src/server/rooms/roomManager.ts`.
- Observation: the existing top-left match ranking already provides the right side-panel surface, so adding KO and ping columns is clearer than introducing a second competing player list.
  Evidence: `src/client/ui/MatchHud.tsx` and `src/client/styles/game.css`.
- Observation: a browser-driven heavy-clash check was timing-sensitive because two separate clients cannot guarantee release packets land on the same authoritative tick.
  Evidence: the full Playwright run reproduced the missing `CLASH` while the isolated scenario passed repeatedly; using a head-on attack geometry with overlapping capsules across adjacent active ticks removed that assumption.

## Decision Log

- Decision: keep live rematch eligibility based on connected `room.players`, but add a separate persisted result roster for presentation.
  Rationale: this keeps rematch/start logic unchanged while letting the result screen preserve historical participant status.
  Date/Author: 2026-08-31, Codex.
- Decision: make overload contribute its literal percentage to extra knockback with a `1 + overload/100` multiplier.
  Rationale: this matches the clarified requirement exactly: 50% overload means 1.5x impulse, 100% means 2x, and the 150% cap means 2.5x.
  Date/Author: 2026-08-31, Codex.
- Decision: measure ping with a server-issued Socket.IO challenge every two seconds, then fold the server-timed sample into normal authoritative match snapshots.
  Rationale: a client-authored latency report can be forged and can amplify broadcasts. Server-side challenge timing makes the displayed RTT authoritative and keeps publication on the normal snapshot cadence.
  Date/Author: 2026-08-31, Codex.
- Decision: keep the match roster as a narrow translucent overlay capped at 178px instead of reserving a wide opaque column.
  Rationale: the user must be able to read names, KO, and ping without losing a meaningful portion of the arena.
  Date/Author: 2026-08-31, Codex.

## Outcomes & Retrospective

The requested combat and room-feedback slice is complete. Knockback now scales directly with accumulated overload, finished standings preserve rematch readiness and departures, and the compact in-match roster shows KO plus server-measured RTT. The final repository gate passed 368 tests across 47 files plus its load and production-build stages; Playwright passed all four flows with eight-player performance at 120.48 median FPS and 16.6ms p95 frame time. Production dependencies reported zero vulnerabilities. Live browser acceptance confirmed `1 ms` values for both local test players, a 178px roster occupying 14.4% of the arena width, and a clean zero-room server after the test.

## Context and Orientation

`src/server/game/combatResolution.ts` owns melee and pulse hit resolution. `applyHit(...)` is the only place that converts `baseImpulse` and `target.overload` into final knockback velocity and hitstun event data.

`src/server/rooms/roomManager.ts` owns room lifecycle. `enterResult(...)` moves the room into `RESULT`, `setResultReady(...)` flips rematch readiness, `leaveRoom(...)` removes connected players, and `publishRoom(...)` is the only path that serializes room state to clients.

`src/shared/model.ts` defines the Socket.IO-visible room/result types. `src/client/ui/ResultScreen.tsx` renders the result table from those shared types. `src/client/state/gameStore.ts` still uses `room.players` for self selection and rematch eligibility, which should remain the authoritative connected-player source.

## Plan of Work

First, add failing tests that prove two distinct behaviors: overload scaling should be directly proportional across representative values, and a result-phase leave should preserve a result-table record instead of erasing the player from the result presentation.

Second, extend the shared room-result payload with a result-specific player roster that includes status derived from result-phase actions. Populate that roster when entering the result phase, update it when players toggle result-ready, and mark entries as left when a player exits during `RESULT`.

Third, update the result UI to render that result roster, including clear Turkish labels for waiting, ready, and left states, while leaving `selectCanStart(...)` and other connected-player logic untouched.

Fourth, have the server sample acknowledged Socket.IO round trips only during active matches, publish the latest bounded value through normal match snapshots, and extend the existing compact top-left roster with accessible KO and ping columns.

## Concrete Steps

Run focused tests from `/Users/serkances/dev/game`:

    npm test -- --run src/server/game/combat.test.ts
    npm test -- --run src/server/rooms/roomManager.test.ts
    npm test -- --run src/client/ui/ResultScreen.test.tsx
    npm test -- --run src/client/network/GameClient.test.ts src/client/ui/MatchHud.test.tsx tests/integration/socketFlow.test.ts

Then run the full gate:

    npm run verify

If verification passes, refresh the LAN server:

    npm run lan

## Validation and Acceptance

Acceptance requires:

1. `src/server/game/combat.test.ts` proves the same hit has larger impulse at higher overload and matches the direct scaling formula.
2. `src/server/rooms/roomManager.test.ts` proves a player who readied in result stays visible as ready, and a player who leaves in result remains visible as left in the result payload.
3. `src/client/ui/ResultScreen.test.tsx` proves the table renders these statuses in Turkish.
4. Network and HUD tests prove one-in-flight RTT sampling, disconnect cleanup, validation, authoritative publication, latency tiers, and no Phaser remount.
5. `npm run verify` passes on the implementation branch.

## Idempotence and Recovery

The type and room-state changes are additive and can be rerun safely. If the result-roster shape causes client test failures, the safe recovery path is to update shared test fixtures and serialization call sites until the protocol is consistent again; no destructive migration is involved.

## Artifacts and Notes

Expected result after implementation:

    low-overload impulse < medium-overload impulse < high-overload impulse

Expected UI behavior after implementation:

    Ada   Hazır
    Linus Ayrıldı

## Interfaces and Dependencies

At the end of the change, `src/shared/model.ts` should expose a result payload that can carry a result-specific roster, and `src/server/rooms/roomManager.ts` should be the sole producer of that roster. `src/client/ui/ResultScreen.tsx` should consume the result roster for presentation only; no other module should need to infer departed result participants.
