# Stabilize combat feedback, ring-out performance, and LAN latency

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current
while work proceeds. It follows `/Users/serkances/.codex/PLANS.md` and implements
`docs/superpowers/specs/2026-09-01-combat-lan-stabilization-design.md`.

## Purpose / Big Picture

After this change, a player can tap or hold `K` without losing the input, reach a
full heavy charge in 450 ms, read the same attack sweep that the server evaluates,
and see several ring-outs without a visible allocation hitch. LAN play remains
host-authoritative over Socket.IO, but the server accepts work at its native 60 Hz
simulation cadence, remote smoothing uses only as much buffer as current jitter
needs, and the roster explains whether a player is on WebSocket or polling and
whether a high value is a stable delay or a spike.

## Progress

- [x] (2026-09-01) Reproduced and isolated latency, hit-readability, and ring-out allocation causes.
- [x] (2026-09-01) Obtained approval for no dead charge threshold and a 450 ms maximum.
- [x] (2026-09-01) Recorded a clean baseline: 51 files and 409 tests passed; committed the approved specification and this plan.
- [ ] Implement charge behavior with a failing-test-first cycle.
- [ ] Implement predicted shared-geometry attack presentation and contact-point feedback with a failing-test-first cycle.
- [ ] Implement bounded reusable ring-out effects with a failing-test-first cycle.
- [ ] Implement 60 Hz scheduling, adaptive interpolation, and truthful network telemetry with a failing-test-first cycle.
- [ ] Run focused, full, load, build, and live browser verification.
- [ ] Review, update outcomes, merge to `main`, push, and restart the LAN runtime.

## Surprises & Discoveries

- Observation: The existing HUD ping is a real Socket.IO acknowledgement RTT, but it includes browser and server event-loop stalls rather than measuring only wire time.
  Evidence: A controlled WebSocket client measured 0–1 ms while delaying the browser acknowledgement by 100 ms produced a 101 ms HUD sample.
- Observation: Remote snapshots are deliberately rendered 70 ms behind receipt and the room scheduler wakes only at 30 Hz even though simulation steps are 60 Hz.
  Evidence: `src/client/game/prediction.ts` defines a 70 ms delay and `src/server/network/createGameServer.ts` schedules `rooms.advance` at `1000 / 30`.
- Observation: One scored knockout creates about 18 Phaser game objects and at least 18 tweens, including two or three newly rasterized text objects.
  Evidence: `src/client/game/phaser/PhaserImpactAdapter.ts` creates rings, twelve shards, edge streak, score, and announcement objects for every knockout.

## Decision Log

- Decision: Keep the direct Socket.IO topology and defer WebRTC to a measured A/B spike only if clean WebSocket latency remains unacceptable.
  Rationale: WebRTC would use the same guest-to-host LAN route and cannot remove browser stalls, the 70 ms interpolation buffer, or the 30 Hz scheduler wait.
  Date/Author: 2026-09-01 / Codex
- Decision: Remove the dead minimum charge window and cap full charge at 450 ms.
  Rationale: `J` already owns quick attacks, so a registered `K` release can always produce the minimum heavy without creating input ambiguity.
  Date/Author: 2026-09-01 / User and Codex
- Decision: Preserve authoritative hit truth while predicting only the local shared-geometry sweep.
  Rationale: This aligns immediate animation and reach cues without allowing a client to decide damage.
  Date/Author: 2026-09-01 / Codex
- Decision: Work on `feature/stabilize-combat-latency` in the current checkout.
  Rationale: The user wants the already-running localhost surface to hot-reload for immediate testing; a feature branch still isolates `main` history.
  Date/Author: 2026-09-01 / Codex

## Outcomes & Retrospective

Implementation has not started. This section will record verified behavior,
remaining limits, and before/after evidence when all acceptance gates pass.

## Context and Orientation

The repository is a TypeScript/Vite/React/Phaser browser game with an Express and
Socket.IO host process. `src/shared/constants.ts` and `src/shared/combat/profiles.ts`
define combat timing and geometry. `src/server/game/combat.ts` advances charge and
attack phases, while `src/server/game/combatResolution.ts` applies swept-capsule
contacts. `src/client/game/prediction.ts`, `src/client/game/phaser/ArenaScene.ts`,
and `src/client/game/phaser/FighterView.ts` present local prediction and remote
snapshots. `src/client/game/phaser/PhaserImpactAdapter.ts` owns transient hit and
ring-out visuals. `src/server/network/socketHandlers.ts`,
`src/server/rooms/roomManager.ts`, and
`src/server/network/createGameServer.ts` own the LAN transport, RTT sampling, room
simulation, and snapshot publication. `src/client/ui/MatchHud.tsx` renders the
compact player roster.

“Round-trip time” means the interval from a server probe until its browser
acknowledgement returns. “Jitter” means variation between consecutive RTT samples.
“Interpolation buffer” means how far behind received snapshots remote fighters are
rendered so uneven arrival times do not visibly stutter. “Predicted sweep” means a
local-only trail animated immediately from the shared attack profile; it never
creates a server hit.

## Plan of Work

First, add combat tests that release a registered charge below the old 180 ms
window, clamp charging at 450 ms, preserve proportional heavy strength, and spawn
the Neon Pulse only at maximum. Watch those tests fail, then remove the obsolete
minimum threshold from server and client prediction and make all charge progress
derive from zero through 450 ms.

Second, add presentation and geometry tests for a non-degenerate local provisional
sweep and a closest capsule-to-hurt-circle contact point. Watch them fail, then
introduce a small attack-trail presenter that tracks a predicted local attack by
profile, facing, and elapsed time, reconciles to authoritative attack IDs, and
keeps remote fallback trails readable across repeated snapshot samples. Emit hit
feedback from the computed contact point while leaving server collision authority
unchanged.

Third, add effect tests that send repeated and same-frame knockout events and
assert bounded object, tween, sound, and camera work. Watch them fail, then reuse
knockout texts, use a bounded pooled shard/ring presentation, and coalesce camera
and knockout audio bursts without removing the readable score and announcement.

Fourth, add tests for a 60 Hz outer room scheduler, an interpolation delay bounded
between 35 and 70 ms, and a rolling network sample window that exposes current,
median, jitter, and transport. Watch them fail, then update the scheduler, timeline,
room state/protocol, socket transport observation, and compact roster. Keep 30 Hz
snapshot publication and polling fallback.

Finally, run all focused suites together, then lint, typecheck, the complete Vitest
suite, the eight-client load gate, and the production build. Exercise a local
two-client match and a scripted simultaneous-knockout burst in a real browser.
Run the Impeccable detector once over changed UI/game presentation targets, fix
material findings in one batch, and repeat the live inspection at most once.

## Concrete Steps

Work from `/Users/serkances/dev/game` on branch
`feature/stabilize-combat-latency`. The baseline command is `npm test`. Focused
commands use `npx vitest run <test files>`. The comprehensive command is
`npm run verify`. Browser acceptance uses the existing Playwright configuration
and the running `http://localhost:4173` LAN server. Keep command transcripts short
and record the final pass counts here.

Baseline transcript:

    npm test
    Test Files  51 passed (51)
    Tests       409 passed (409)

## Validation and Acceptance

A short registered `K` press followed by release must create a minimum heavy; a
450 ms hold must display pulse readiness and create exactly one pulse on release.
The local trail must enter its active sweep in the same authored timeline as the
body animation, and its points must come from the shared profile. Repeated
authoritative snapshots must not collapse the visible active trail to a dot.
Confirmed hit particles must originate at the contact edge, not the defender
center.

Four ring-outs presented in one burst must keep resource counts bounded and must
not create a new text texture for every event. On this development machine, the
browser performance scenario should sustain a 60 fps-class frame budget without
a new frame over 50 ms attributable to ring-out presentation.

The server scheduler test must observe a `1000 / 60` interval while snapshots
remain 30 Hz. Interpolation must settle near 35 ms on regular arrivals and never
leave the 35–70 ms range under jitter. The roster must show WebSocket or polling,
median RTT as its primary number, and current/jitter detail without increasing the
roster footprint enough to cover the arena.

## Idempotence and Recovery

Tests, builds, and server restarts are repeatable. No persistent data migration is
involved. If a focused change regresses another package, revert only that task's
commit on the feature branch; never reset or discard unrelated work. The original
`main` commit is `ab8c93514ce0c94b56bc890b167f28198f706251`.

## Artifacts and Notes

The controlled baseline previously observed WebSocket RTT of 0–1 ms, polling RTT
of 1–4 ms, and a deliberately delayed acknowledgement of 101 ms. These numbers
prove that the displayed value includes main-thread scheduling and that transport
migration alone cannot explain a 100 ms spike.

## Interfaces and Dependencies

Reuse Phaser, Socket.IO, React, Vitest, and Playwright already installed in the
repository. Do not add a networking, animation, or statistics dependency. The
network presentation must expose one serializable status per player containing
`currentMs`, `medianMs`, `jitterMs`, and `transport`, where transport is
`websocket` or `polling`. The interpolation implementation must expose its current
bounded delay to tests without introducing a production-only debug route.

Revision note (2026-09-01): Initial approved plan created after root-cause audits
and the user's confirmation of threshold-free, 450 ms heavy charging.
