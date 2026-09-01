# Neon Knockout Combat and LAN Stabilization

**Status:** Stage A implemented; representative multi-device LAN A/B pending
**Date:** 2026-09-01
**Scope:** Existing Knockout FFA mode and its direct host-to-guest LAN runtime

This document supersedes only the heavy-charge timing, attack-trail presentation,
ring-out effect lifecycle, latency presentation, server scheduling, and remote
interpolation clauses of the approved 2026-08-31 core-combat redesign. Every
unrelated control, combat, room, scoring, mobile, and reconnect decision remains
unchanged.

## User-visible outcome

Registered `K` presses are never discarded. Releasing `K` always starts a melee
heavy attack whose power is proportional to the held duration; maximum power and
Neon Pulse readiness arrive after 450 ms. Quick and heavy sweep cues begin in
step with the local animation, continue to use the shared authoritative geometry,
and confirmed-hit feedback appears at the actual attack/hurtbox contact point.

Several ring-outs in one moment must not allocate an unbounded collection of
text, shape, sound, camera, and tween objects. Reusable presentation resources
and same-frame coalescing keep the effect readable without a visible hitch.

Stage A keeps the direct, host-authoritative Socket.IO topology. The server
advances rooms and publishes snapshots at 60 Hz. Remote interpolation adapts
between 16 and 40 ms based on recent snapshot arrival jitter. The compact player
roster reports each opponent's current `Ping` and median `RTT`, while every player
sees their own presentation Delay and the number of unacknowledged local input
frames replayed during the latest authoritative reconciliation. Transport and
jitter remain in the authoritative network snapshot for diagnostics. Raw spikes
remain visible and the worse of current/median latency controls the warning tier. A healthy
foreground client on the same router should normally show a median of 20 ms or
less, but the UI must not claim an absolute Wi-Fi guarantee.

Stage B is conditional: only a post-Stage-A LAN A/B report that still identifies
WebSocket/TCP queueing as the load-bearing delay can open a separately approved
WebRTC data-channel implementation. Socket.IO remains available for signaling and
recovery in that future design; this Stage A package does not pre-empt the result.

## Boundaries

The server remains the only authority for hit, clash, projectile, knockout, and
score results. Local predicted sweeps are presentation only and reconcile to the
next authoritative attack. Existing polling fallback remains available for
devices that cannot establish WebSocket; the roster labels that fallback rather
than silently presenting it as equivalent.

No WebRTC signaling, ICE, STUN, TURN, peer mesh, cloud service, new game mode,
new combat button, or balance system is added in Stage A. The visual identity,
chassis art, arena layout, and control map remain intact.

## Acceptance

Automated tests must prove that a registered heavy release at any positive held
duration starts an attack, maximum charge clamps at 450 ms, and a full charge
still creates one Neon Pulse. Presentation tests must prove that a local predicted
attack produces a non-degenerate shared-geometry sweep before the delayed
authoritative snapshot and that hit events use a geometry-derived contact point.
Effect tests must prove repeated and simultaneous ring-outs reuse bounded visual
and audio resources. The browser burst must preserve a Pulse created through real
match input while producing four real hits and boundary knockouts. Network tests
must prove 60 Hz scheduling and snapshot publication, 16–40 ms bounded adaptive
interpolation, rolling median/jitter calculation, explicit WebSocket/polling
reporting, and publication of opponent Ping/RTT plus the local presentation buffer
and prediction replay-frame count to the HUD.

The focused tests, complete unit/integration suite, load test, lint, typecheck,
production build, and a live browser match must pass. A live burst scenario must
show no new long-frame regression when several ring-outs are presented together.
