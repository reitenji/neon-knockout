# Neon Knockout Combat and LAN Stabilization

**Status:** Approved
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

The game keeps its direct, host-authoritative Socket.IO topology. It does not
migrate to WebRTC in this package. The server advances rooms at 60 Hz while
snapshots remain 30 Hz. Remote interpolation adapts between 35 and 70 ms based
on recent snapshot arrival jitter. The compact player roster reports the active
transport plus median round-trip time, current round-trip time, and jitter without
hiding raw spikes. A healthy foreground client on the same router should normally
show a median of 20 ms or less, but the UI must not claim an absolute Wi-Fi
guarantee.

## Boundaries

The server remains the only authority for hit, clash, projectile, knockout, and
score results. Local predicted sweeps are presentation only and reconcile to the
next authoritative attack. Existing polling fallback remains available for
devices that cannot establish WebSocket; the roster labels that fallback rather
than silently presenting it as equivalent.

No WebRTC signaling, ICE, STUN, TURN, peer mesh, cloud service, new game mode,
new combat button, or balance system is added. The visual identity, chassis art,
arena layout, and control map remain intact.

## Acceptance

Automated tests must prove that a registered heavy release at any positive held
duration starts an attack, maximum charge clamps at 450 ms, and a full charge
still creates one Neon Pulse. Presentation tests must prove that a local predicted
attack produces a non-degenerate shared-geometry sweep before the delayed
authoritative snapshot and that hit events use a geometry-derived contact point.
Effect tests must prove repeated and simultaneous ring-outs reuse bounded visual
and audio resources. Network tests must prove 60 Hz scheduling, bounded adaptive
interpolation, rolling median/jitter calculation, and explicit WebSocket/polling
reporting.

The focused tests, complete unit/integration suite, load test, lint, typecheck,
production build, and a live browser match must pass. A live burst scenario must
show no new long-frame regression when several ring-outs are presented together.

