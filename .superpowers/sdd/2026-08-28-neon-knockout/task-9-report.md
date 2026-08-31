# Task 9 release-candidate evidence

## Candidate state and ownership

Task 8 began from controller base `b6ad47e` (`docs: define room settings`). The controller subsequently added the room-settings plan commit `391b1d8`; neither room-settings implementation nor the controller-owned core-combat plan/spec edits are part of this delivery slice. The Task 8 candidate is the commit containing this report. Its immutable SHA, the controller-owned live visual journey, broad branch review, publication, merge, and final accepted-SHA documentation remain controller-owned so this tracked report does not create a circular self-SHA claim.

The candidate changes the physical controls to `WASD` movement/aim, `J` quick attack, held/released `K` heavy attack, and `Space` dash without changing the `InputFrame` wire contract. Arrow keys, both Shift keys, and mouse input are inert. The HUD and README describe the same controls and the 600 ms return plus 78/75/40-second arena pacing.

## TDD and authoritative coverage

- Input remap RED: the old physical mapping failed 13 of 28 focused assertions in 3.03 s (4.02 s real). GREEN: 4 files / 28 tests passed in 2.78 s (3.65 s real), including raw-key release gates across reset/blur/pause/sleep.
- Private harness/integration RED: 6 of 8 rewritten authoritative matrix cases failed before the bounded placement/event helpers existed. GREEN: the expanded matrix passed 9 of 9 in 4.98 s (5.72 s real), including quick/quick, heavy/quick, heavy/heavy, attack/pulse, pulse/player, perfect dodge, charge interruption, event ordering, exact 600 ms return, 78/75/40 pacing, and credited-KO sudden death.
- Pending input-edge RED: a quick pulse followed by a newer neutral frame was lost before `advance` (1 failed / 13 passed). GREEN: RoomManager passed 14 of 14 after coalescing only unprocessed `quick` and `dash` edges into the newest monotonic frame; movement, aim, heavy, and sequence remain newest-frame values, and neither edge replays later.
- Static fallback RED: a dotted absolute client path returned 404. GREEN: the focused regression returned 200 after using Express's rooted `sendFile` form; no production route was added.
- Ground-footprint RED: the real FighterView graphics harness observed three decorative polygons (1 failed / 5 passed). GREEN: 6 of 6 passed after removing only the colored contact-footprint layer and its pose writes. Local marker, chassis/accent, charge, attack trail, labels, and combat feedback remain.
- Browser dodge RED: a simultaneous quick/dash sequence intermittently produced a real quick hit after dash invulnerability expired. GREEN: an observable partial-heavy windup/tick sequence produced authoritative `PERFECT_DODGE` in two consecutive focused journeys (17.5 s and 18.2 s).

## Verification evidence

Pre-commit `npm run verify` passed in 36.445 s real: ESLint, both TypeScript projects, 45 Vitest files / 306 tests (13.90 s), the 8-client load test (13.07 s test / 13.35 s suite), and the production build. The load clients each received 391 snapshots over 10 seconds while sending monotonic keyboard-semantic movement, quick, heavy, dash, and idle frames; all clients and server handles closed cleanly.

Pre-commit `npm run test:e2e` passed both scenarios in 28.7 s (31.397 s real). The 2-context journey used real browser keyboard input to prove inert mouse/arrows/Shifts, WASD movement and diagonal aim, quick hit, partial-heavy melee-only release, one full-charge pulse, heavy clash, perfect dodge, reconnect identity/stats with neutral input, result, and rematch. `forceKnockout` was used only for the final result setup after real authoritative hit/clash/dodge evidence.

The binding performance model is one real 1280x720 Chromium renderer displaying all eight authoritative fighters plus seven lightweight active Socket.IO participants. All eight players completed legal input choreography; the browser used real `J`, `K`, and `Space`, received full snapshots/effects, and recorded 180 requestAnimationFrame samples at median **119.05 FPS** and **16.7 ms p95**. Page, console, and server error collectors were empty.

Earlier same-host multi-renderer experiments were rejected as non-representative of LAN resource boundaries and are not acceptance evidence. For diagnosis only, eight independent Metal processes measured about 59.52 FPS with 25.6-25.9 ms p95, while shared-browser multi-renderer attempts measured roughly 9-20 FPS. No threshold, player count, input load, rendered-player count, or effect coverage was reduced in the accepted model.

## Harness and release boundary

`testHarness` is created only with `enableTestHarness: true`; the disabled production server exposes `null`. Placement and returned values are bounded/cloned, event history is capped at 256 entries, and room/match/server cleanup clears it. No HTTP route or Socket.IO event exposes placement, forced knockout, disconnect, snapshots, or recent events. The static production fallback is ordinary asset serving only.

The public remote was read-only verified as `https://github.com/reitenji/neon-relay` with visibility `PUBLIC`. Post-commit verification, localhost/private-LAN health probes, server cleanup, controller live visual acceptance, broad review, push, merge, and final GitHub SHA equality are recorded separately after this candidate commit exists.
