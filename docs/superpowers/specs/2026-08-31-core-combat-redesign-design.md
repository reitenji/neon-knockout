# Neon Knockout Core Combat Redesign

**Status:** Approved for implementation planning  
**Date:** 2026-08-31  
**Scope:** Existing Knockout FFA mode only

This document supersedes the input, combat geometry, attack presentation,
knockout-return, and contraction timing clauses in the 2026-08-28 Neon
Knockout design. LAN/session behavior and every unrelated clause remain in
force.

## Context

The LAN, room, authoritative simulation, Phaser presentation, reconnect, and
result/rematch foundations remain. The current combat layer is being replaced
because live play exposed four connected problems:

1. mouse aim plus mouse buttons are not a fair or comfortable common control
   scheme;
2. attacks are resolved as center-origin sectors that do not match the visible
   chassis or weapon motion;
3. a partially charged heavy attack snaps to a full-charge release pose; and
4. the first half of a two-minute match is too passive even though the total
   match length is appropriate.

The existing FFA mode stays the first shippable mode. **Neon Crown** and
**Knockout Rounds** are approved future modes, but they are deliberately out of
scope for this redesign. No speculative mode framework will be added now.

## Goals

- Give every player the same keyboard-only, eight-direction control scheme.
- Make authoritative hit detection and the visible attack sweep share one
  geometry definition.
- Make quick, charged, ranged, clash, and dodge outcomes readable before and
  after contact.
- Preserve immediate control and the existing short, penalty-free knockout
  return.
- Create more frequent conflict inside the existing 120-second FFA match.
- Preserve deterministic 60 Hz server simulation and 2–8 player LAN play.

## Non-goals

- Neon Crown, Knockout Rounds, teams, classes, pickups, random buffs, or arena
  hazards.
- Mouse, touch, mobile, controller, or multiple control presets.
- Different gameplay stats for the four chassis.
- WAN matchmaking, accounts, persistence, or a cloud service.

## Controls

There is one control scheme for every player:

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Arrow key(s) | Immediate quick attack in that direction |
| Hold `Shift` + arrow key(s) | Charge a heavy attack and steer its direction |
| Release `Shift` | Lock the current direction and release the heavy attack |
| `Space` | Dash along movement input, or facing when stationary |

Opposing direction pairs cancel. Two perpendicular arrow keys form a normalized
diagonal. A quick attack begins on the transition from no held attack direction
to one or more arrow keys while `Shift` is not held.

Holding an arrow never auto-repeats a quick attack: every combo step needs an
arrow release followed by a new press. Heavy charge begins when `Shift` is
pressed with a valid arrow direction already held, or when a valid arrow
direction is first pressed while `Shift` is held.

While `Shift` is held, arrow changes update the heavy aim in eight directions.
Releasing all arrows retains the last valid heavy direction and continues the
charge. Releasing `Shift` locks that direction for windup, contact, recovery,
and any full-charge projectile. A release before the existing 180 ms minimum
charge cancels without producing an attack.

The client continues to send normalized `moveX`, `moveY`, `aimX`, `aimY`,
`quick`, `heavy`, and `dash` fields. Their protocol shape remains stable; only
the input source changes. Mouse position and mouse buttons no longer influence
gameplay. Gameplay keys prevent their browser scrolling/default actions while
the arena owns focus. Blur, hidden-document, scene shutdown, and disconnect
clear every held key and require a full release before accepting held input
again.

## Combat model

### Shared geometry

The server and Phaser presentation will consume the same pure attack-shape
profiles. Each profile defines its windup, active, and recovery durations plus
the weapon origin offset, sweep path, thickness, and reach.

Every fighter has one circular hurtbox with identical gameplay dimensions.
Quick and melee-heavy attacks use a front-anchored swept capsule: the capsule is
formed by the weapon point's previous and current authoritative positions during
the active window, expanded by its attack thickness. A hit occurs when this
capsule intersects a target hurt circle. Continuous sweep checks prevent fast
attacks from tunnelling between 60 Hz ticks.

An attack can hit several overlapping opponents in FFA, but each attack ID can
hit each target ID only once. Chassis artwork may differ, but all four chassis
use the same hurtbox and attack profiles.

### Quick combo

The three-step quick combo remains. Each step has a distinct sweep, reach,
contact frame, impulse, overload gain, and recovery. Direction locks when that
step begins. Existing late-recovery buffering remains, but a buffered step uses
the direction held when the buffered attack becomes committed.

### Heavy charge and release

Heavy charge remains steerable until `Shift` is released. Any confirmed hit
during charge cancels it. The release begins from the exact pose represented by
the current authoritative charge duration rather than assuming a full charge.

Partial heavy releases are melee-only. A heavy that reaches the 700 ms maximum
also creates one **Neon Pulse** from the melee sweep's forward edge:

- speed: 900 world units per second;
- lifetime: 400 ms, for a maximum travel distance of 360 world units;
- circular collision radius: 18 world units;
- first target or valid clash consumes it;
- 14 overload and 340 base impulse, lower than a full melee heavy;
- the pulse and its originating melee attack share target deduplication, so the
  same target cannot be struck twice by one release.

Neon Pulse gameplay values are identical for every chassis. Only its authored
shape, particles, and sound may vary with chassis/accent.

### Clashes and perfect dodge

Clashes are resolved deterministically before attacks are applied to player
hurtboxes:

- active quick versus active quick cancels both contact attempts, applies a
  small symmetric recoil, and adds no overload;
- active heavy versus active quick cancels the quick and allows the heavy to
  continue;
- active heavy versus active heavy cancels both and applies stronger symmetric
  recoil;
- an active quick or heavy sweep destroys a Neon Pulse it intersects;
- a dash-invulnerable fighter takes no hit from an intersecting attack shape.

The first avoided attack during one dash produces a `PERFECT_DODGE` event. It
refunds 550 ms of the 1,100 ms dash cooldown, never more than once per dash, and
does not add damage, overload, or invulnerability. This makes timing rewarding
without adding another button or a hidden power state.

## Authoritative phase order

Each server step follows this observable order:

1. validate and normalize the latest monotonic input frame;
2. advance timers and commit input edges;
3. advance movement, dash, and separation;
4. advance Neon Pulse projectiles continuously;
5. build active attack shapes from shared profiles;
6. resolve attack/attack and attack/projectile clashes;
7. resolve surviving shapes against player hurtboxes;
8. apply impulse, overload, hitstun, and perfect-dodge cooldown refund;
9. resolve arena boundary knockouts, scoring, respawn, and match phase changes.

Stable player, attack, projectile, and event IDs break all remaining ties.

## Component boundaries

- The Phaser input source owns physical key state and produces the existing
  normalized input frame. It does not decide combat results.
- A shared pure combat-geometry module owns hurt circles, attack sweep profiles,
  continuous capsule intersection, pulse travel shapes, and clash intersection.
- The server combat layer owns attack lifecycles, clash priority, deduplication,
  overload, impulse, hitstun, perfect-dodge refunds, and events.
- A focused server projectile module owns pulse creation, continuous movement,
  lifetime, collision candidates, and cleanup; it does not own scoring.
- Client prediction anticipates local input and pose only. Authoritative server
  snapshots/events remain the source of hit, clash, dodge, pulse, and knockout
  truth.
- `AnimationDirector`, fighter views, effects, audio, and HUD consume shared
  profiles plus authoritative state; none reconstruct a separate combat model.

## Presentation and animation

Animation timing is driven by the same combat profiles as the server.

- Quick contact poses occur inside their authoritative active windows.
- Heavy charge pose is sampled directly from `chargeMs / 700`.
- Heavy release starts by blending from the current sampled charge pose; it
  never jumps to a full-charge keyframe.
- Facing may change during charge, but locks on release.
- Attack trails render the shared sweep path, so the visible reach is the
  authoritative reach.
- Neon Pulse uses its authoritative position and radius rather than a separate
  client-only trajectory.
- `CLASH`, `PERFECT_DODGE`, pulse spawn, pulse break, hit, and knockout each have
  deduplicated event feedback.

Server time never pauses. Hit-stop is presentation-only, local to the affected
fighters, and capped at 35 ms. Reduced-motion mode keeps state clarity while
removing hit-stop, large shake, and fast camera displacement. It never changes
input, hitbox, projectile, or simulation timing.

The HUD shows the keyboard-only controls. The local combat block shows heavy
charge percentage and a clear **PULSE READY** state at maximum charge. The
fighter carries a compact eight-direction charge indicator. Large announcements
remain transient and never cover combat for an entire phase.

## Match pacing

Knockout FFA remains 120 seconds or first to five credited knockouts.

- A three-second contraction warning begins with 78 seconds remaining.
- Arena contraction begins with 75 seconds remaining.
- The arena reaches minimum size with 40 seconds remaining and stays there.
- A normal knockout returns control within 600 ms.
- Overload resets on respawn; score and match statistics persist.
- Spawn protection remains brief and cancels immediately when that player
  attacks.
- A self-fall awards no point.
- A tied regulation result enters sudden death on the minimum arena; the next
  credited knockout wins, while an uncredited self-fall does not end the match.

There is no escalating knockout penalty, inventory, random pickup, or snowball
buff.

## State and protocol changes

The existing input frame remains compatible. Combat state gains only fields
required by the approved behavior:

- an attack's stable profile ID, locked facing, active progress, and hit-target
  set;
- one perfect-dodge-consumed flag for the current dash;
- authoritative pulse entities with projectile ID, owner ID, originating attack
  ID, position, velocity, radius, remaining lifetime, and hit-target set;
- `CLASH`, `PERFECT_DODGE`, `PULSE_SPAWN`, and `PULSE_BREAK` game events.

Snapshots include active pulses so every client renders the same trajectory.
No test-only HTTP or socket route is added. Existing in-process test harness
access stays private to automated tests.

## Recovery and edge cases

- If aim keys conflict or disappear, the last valid facing is retained.
- Window blur, visibility loss, disconnect, and scene teardown cancel local held
  charge and suppress held input until release.
- Reconciliation may correct position and combat state but must not restart an
  unchanged attack animation or replay a local sound.
- A reconnect preserves identity, score, statistics, chassis, accent, and
  authoritative overload, while client-held inputs start neutral.
- Projectiles disappear on owner room removal, match reset, result transition,
  and server shutdown.
- Event IDs remain monotonic and presentation consumes every event at most once.

## Verification strategy

### Unit and property tests

- Keyboard sampling: cardinal/diagonal quick edges, Shift charge steering,
  release locking, early cancel, dash direction, blur suppression, and 60 Hz
  cap.
- Shared geometry: swept-capsule/hurt-circle boundaries, continuous collision,
  profile reach, rotational symmetry, and no duplicate target hit.
- Animation: partial-charge release begins from the exact preceding pose; active
  contact frames align with shared profiles; duplicate snapshots do not restart
  plans.
- Projectile: travel distance, lifetime, first-target consumption, melee/pulse
  deduplication, and cleanup.

### Authoritative combat tests

- quick/quick, quick/heavy, heavy/heavy, attack/pulse, and dash/attack outcomes;
- one perfect-dodge refund per dash and the exact 550 ms refund cap;
- charge interruption, eight-direction release locking, and deterministic event
  order;
- 600 ms knockout return, earlier contraction, tie/sudden-death behavior, and
  no score for self-fall.

### Integration and browser acceptance

- Two isolated browser contexts create/join/ready/start and complete movement,
  diagonal quick, steerable partial heavy, full-charge Neon Pulse, clash,
  perfect dodge, knockout, result, rematch, and reconnect flows.
- Confirmed hit geometry is asserted from authoritative events/snapshots, not
  inferred from animation alone.
- The eight-client 60 Hz load gate still yields at least 250 snapshots per
  client in ten seconds with no unexpected errors or leaked handles.
- The eight-fighter effect burst retains median 58 FPS or better and p95 frame
  duration below 25 ms on the acceptance host.
- Visual inspection covers 900×600 and larger desktop viewports, default and
  reduced-motion modes, without clipped HUD, hidden fighters, permanent
  announcements, or attack trails that disagree with the shared hit shape.

## Acceptance criteria

The redesign is accepted only when all of the following are demonstrated on one
commit:

1. No mouse action changes movement, facing, or attacks.
2. Keyboard quick, steerable charge, locked release, dash, and diagonal input
   work in a real two-browser match.
3. Partial heavy release has pose continuity; full charge visibly produces one
   authoritative Neon Pulse.
4. Every confirmed hit intersects the shared visible shape and target hurtbox;
   known near-miss cases do not hit.
5. Clash and perfect-dodge outcomes are deterministic and visibly distinct.
6. A knockout returns control within 600 ms without a power or score penalty.
7. The two-minute match contracts from 75 to 40 seconds remaining and tied
   regulation enters readable sudden death.
8. Unit, integration, E2E, load, build, lint, typecheck, LAN health, and public
   repository verification all pass for the same accepted commit.
