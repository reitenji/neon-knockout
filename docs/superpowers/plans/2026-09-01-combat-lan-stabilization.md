# Stabilize combat feedback, ring-out performance, and LAN latency

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current
while work proceeds. It follows `/Users/serkances/.codex/PLANS.md` and implements
`docs/superpowers/specs/2026-09-01-combat-lan-stabilization-design.md`.

## Purpose / Big Picture

After this change, a player can tap or hold `K` without losing the input, reach a
full heavy charge in 450 ms, read the same attack sweep that the server evaluates,
and see several ring-outs without a visible allocation hitch. LAN play remains
host-authoritative while the server accepts work and publishes snapshots at its
native 60 Hz simulation cadence. Remote smoothing uses a 16–40 ms adaptive LAN
buffer, and the roster separates each opponent's current/median RTT from the
local presentation delay and rollback-frame count. WebRTC is a measured second-stage transport change, not a
prerequisite for proving the lower-latency Socket.IO path.

## Progress

- [x] (2026-09-01) Reproduced and isolated latency, hit-readability, and ring-out allocation causes.
- [x] (2026-09-01) Obtained approval for no dead charge threshold and a 450 ms maximum.
- [x] (2026-09-01) Recorded a clean baseline: 51 files and 409 tests passed; committed the approved specification and this plan.
- [x] (2026-09-01) Implemented threshold-free 450 ms charge behavior and its focused tests.
- [x] (2026-09-01) Implemented predicted shared-geometry attack presentation and contact-point feedback with focused tests.
- [x] (2026-09-01) Implemented bounded reusable ring-out effects and replaced the synthetic burst acceptance with four simultaneous real hits followed by four real boundary knockouts.
- [x] (2026-09-01) Recorded the interim 30 Hz snapshot and 35–70 ms interpolation baseline before applying the approved Stage A latency changes.
- [x] (2026-09-01) Separated current RTT, median RTT, jitter, transport, presentation delay/frames, and true prediction-replay rollback frames in the compact HUD.
- [x] (2026-09-01) Published authoritative snapshots at 60 Hz and lowered the adaptive LAN interpolation band to 16–40 ms.
- [x] (2026-09-01) Verified the genuine four-hit/four-ring-out browser lifecycle with a pre-existing live Pulse, a 17.7 ms correlated maximum frame, and no forced knockout hook.
- [ ] Run a post-change LAN A/B gate and proceed to a WebRTC data-channel design only if TCP transport remains the measured bottleneck.
- [x] (2026-09-01) Passed focused tests, 452-test full Vitest suite, eight-client load gate, production build, all 9 Playwright scenarios, and desktop/mobile browser acceptance.
- [x] (2026-09-01) Completed final review and updated outcomes for publication to `main`.

## Surprises & Discoveries

- Observation: The existing HUD ping is a real Socket.IO acknowledgement RTT, but it includes browser and server event-loop stalls rather than measuring only wire time.
  Evidence: A controlled WebSocket client measured 0–1 ms while delaying the browser acknowledgement by 100 ms produced a 101 ms HUD sample.
- Observation: Remote snapshots are deliberately rendered 70 ms behind receipt and the room scheduler wakes only at 30 Hz even though simulation steps are 60 Hz.
  Evidence: `src/client/game/prediction.ts` defines a 70 ms delay and `src/server/network/createGameServer.ts` schedules `rooms.advance` at `1000 / 30`.
- Observation: One scored knockout creates about 18 Phaser game objects and at least 18 tweens, including two or three newly rasterized text objects.
  Evidence: `src/client/game/phaser/PhaserImpactAdapter.ts` creates rings, twelve shards, edge streak, score, and announcement objects for every knockout.
- Observation: The host's Wi-Fi path is itself jittery before Socket.IO or game rendering is involved.
  Evidence: Fifty ICMP samples to `192.168.68.1` measured 2.542 ms minimum, 12.624 ms average, 64.736 ms maximum, and 17.724 ms standard deviation with no packet loss.
- Observation: Server combat computation is not a material latency source.
  Evidence: An eight-player `stepMatch` benchmark measured 0.0227 ms mean and 0.0299 ms p95 against a 16.67 ms tick budget.
- Observation: Four genuinely simultaneous combat hits and their four credited boundary ring-outs no longer reproduce the old presentation hitch, even while an already-live Pulse continues in flight.
  Evidence: The production-path browser scenario observed four `HIT` events at tick 296, four `KNOCKOUT` events at tick 298, retained the same pre-existing projectile id, and measured a 17.7 ms maximum frame across the full 72-frame ring-out effect window.
- Observation: A rollback frame is measurable without adding rollback netcode: it is the count of unacknowledged local input frames replayed after an authoritative snapshot reconciliation.
  Evidence: The prediction buffer publishes its pending replay count through the scoped presentation bridge, and the live two-client HUD displayed `Rollback 0f` to `1f` while receiving 60 Hz snapshots.

## Decision Log

- Decision: Keep the direct Socket.IO topology and defer WebRTC to a measured A/B spike only if clean WebSocket latency remains unacceptable.
  Rationale: WebRTC would use the same guest-to-host LAN route and cannot remove browser stalls, the 70 ms interpolation buffer, or the 30 Hz scheduler wait.
  Date/Author: 2026-09-01 / Codex
- Decision: Ethernet is not available; reduce software-added latency first by separating diagnostics, publishing snapshots at 60 Hz, and using a 16–40 ms adaptive LAN buffer.
  Rationale: The user approved items 2–5 after ruling out a wired host, and these changes directly remove measurable snapshot and presentation delay before a transport rewrite.
  Date/Author: 2026-09-01 / User and Codex
- Decision: Treat WebRTC as Stage B and enter it only when the Stage A A/B report shows WebSocket/TCP queueing remains load-bearing.
  Rationale: This preserves the approved option while keeping the smallest end-to-end system working and measured at every layer.
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

Stage A is implemented and locally accepted. The server now advances and publishes
at 60 Hz, remote presentation delay stays within 16–40 ms, and the compact HUD
shows each opponent's current `Ping` and median `RTT` while each player sees their
own Delay and real replayed-frame count. The network snapshot still retains jitter
and active transport for diagnostics. A real combat browser test
drives four attacker/target pairs through normal input, contact resolution, and
boundary knockout while preserving a Pulse spawned through normal match input;
its latest full-suite run measured a 17.7 ms correlated and global maximum frame.

The complete verification pass contains 53 Vitest files and 452 tests, the
eight-client load gate, client/server production builds, and 9 Playwright flows
covering invite, lobby settings, keyboard combat, reconnect, rematch, result
status, mobile touch, polling fallback, eight-player rendering, and the genuine
ring-out burst. A live desktop and 844×390 browser check showed the telemetry
without arena obstruction and produced no console errors.

The only remaining latency acceptance is intentionally physical: another device
must join over the representative Wi-Fi/LAN so the new metrics can distinguish
real network RTT from presentation delay and prediction replay. WebRTC remains a
conditional Stage B experiment, not an unverified migration claim.

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

Fourth, add tests for a 60 Hz outer room scheduler and snapshot publisher, an
interpolation delay bounded between 16 and 40 ms, and a compact HUD that presents
RTT, jitter, transport, and the local presentation buffer as distinct values. Watch
them fail, then update the snapshot cadence, timeline, presentation bridge, and
roster while retaining polling as a visible fallback rather than mislabeling it as
WebSocket.

Fifth, run a two-client A/B acceptance that records transport, RTT median, jitter,
presentation buffer, snapshot cadence, and frame time. If WebSocket remains the
measured bottleneck after Stage A, write and approve a dedicated WebRTC design for
Socket.IO signaling plus latency-oriented data channels; do not blend that
architectural migration into the bounded Stage A implementation.

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

Final local transcript:

    npm run verify
    Test Files  53 passed (53)
    Tests       452 passed (452)
    Load tests  1 passed (1)
    Client/server production build passed

    npx playwright test --workers=1
    Tests       9 passed (9)
    Eight-player p95 frame time  17.6 ms
    Four-hit/four-ring-out correlated max frame  17.7 ms

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

The server scheduler and snapshot publication tests must both observe 60 Hz pacing.
Interpolation must settle near 16 ms on regular arrivals and never leave the
16–40 ms range under jitter. The roster must separately show opponent `Ping/RTT`
and local Delay/Rollback frames without increasing its footprint enough to cover
the arena. The network snapshot must retain transport and jitter so the Stage A
browser A/B can record them before any WebRTC migration is considered complete.

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
and the user's confirmation of threshold-free, 450 ms heavy charging. Updated
after live Wi-Fi measurements and the user's approval of separated diagnostics,
60 Hz snapshots, lower adaptive interpolation, and a conditional WebRTC stage.
Updated again after the full Stage A implementation, genuine combat/ring-out
performance acceptance, complete verification, and live responsive HUD review.
