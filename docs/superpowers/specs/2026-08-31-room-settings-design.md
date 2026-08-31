# Neon Knockout Room Settings and Leave Lifecycle

**Status:** Approved for implementation planning
**Date:** 2026-08-31
**Scope:** Existing Knockout FFA room, lobby, match, and result lifecycle only

## Context

Every room currently plays one fixed 120-second, first-to-five-knockouts
match. The room owner needs a small, fair rules panel before the match starts.
The settings must be authoritative, visible to every participant, preserved
through the existing LAN lifecycle, and must not turn into a general game-mode
or custom-rules framework.

## Goals

- Let the current room owner select match duration and knockout target in the
  lobby.
- Keep defaults identical to the existing game: 120 seconds and five credited
  knockouts.
- Show every participant the same server-owned settings before and during the
  match.
- Preserve settings across reconnect, host migration, return-to-lobby, result,
  and rematch flows.
- Scale arena contraction with the selected duration so each option preserves
  the approved combat tempo.
- Let a participant explicitly leave from any room screen, invalidate that room
  session immediately, and return to the landing screen without disconnecting
  the underlying Socket.IO transport.
- Keep the remaining room usable: migrate the host, close an empty room, and
  apply the existing population/no-contest policy to an active match.

## Non-goals

- Free-form numeric inputs, arbitrary rules, per-player settings, teams, modes,
  maps, bots, hazards, pickups, WAN matchmaking, persistence, or accounts.
- Changing settings during countdown, regulation, sudden death, or result.
- Adding a compatibility layer for clients that do not understand room
  settings.
- Kicking another player, banning, ownership selection, room discovery,
  spectator mode, or a room-management framework.

## Fixed options and defaults

The shared contract is:

```ts
export type MatchDurationMs = 90_000 | 120_000 | 180_000;
export type KnockoutTarget = 3 | 5 | 7 | 10;

export type RoomSettings = Readonly<{
  durationMs: MatchDurationMs;
  knockoutTarget: KnockoutTarget;
}>;
```

The only accepted options are:

- duration: 90 seconds, 120 seconds, or 180 seconds;
- knockout target: 3, 5, 7, or 10 credited knockouts;
- default: `{ durationMs: 120_000, knockoutTarget: 5 }`.

The client uses select controls rather than arbitrary numeric inputs. The
server rejects values outside these exact sets and rejects unknown fields.

## Authoritative data flow

`Room` owns one `settings` value from creation until the room is destroyed.
`RoomState` publishes a copy to every connected or resumed participant. The
current host changes the complete pair through one acknowledged
`lobby:settings` event with payload `{ durationMs, knockoutTarget }`.

The server accepts a change only when:

1. the sender belongs to the room;
2. the room phase is `LOBBY`;
3. the sender is the current `hostPlayerId`; and
4. both values are exact supported options.

Submitting the current pair is an idempotent no-op. A real change clears the
`ready` flag for every player before publishing the new `RoomState`; nobody can
remain silently ready after the host changes the rules. Existing domain errors
handle non-host, invalid-phase, and invalid-value failures.

`startMatch` copies the current room settings into `MatchState`. That match copy
is immutable and is serialized in every `MatchSnapshot`, so server simulation,
HUD, Phaser presentation, reconnect, and result consumers agree without reading
mutable lobby state. A direct rematch from `RESULT` uses the room's unchanged
settings. To edit rules after a result, the host returns to the lobby first.

Host migration changes write authority, not the settings. A disconnected
former host does not regain authority when resuming unless it is still the
current host according to the existing migration rule.

## Explicit leave lifecycle

Every participant can send one acknowledged `room:leave` request with a strict
empty payload from `LOBBY`, `COUNTDOWN`, `MATCH`, or `RESULT`. This is an
intentional departure rather than a recoverable transport interruption:

1. the server removes the connection membership, player record, pending input,
   match entity, score entry, and player-owned pulses immediately;
2. the removed resume token is no longer valid and receives no reconnect grace;
3. the Socket.IO connection stays open, leaves the old room channel, and may
   create or join another room;
4. if the departing player was host, authority moves to the earliest connected
   remaining player;
5. if no player remains, the room is destroyed and publishes `ROOM_CLOSED`;
6. a lobby departure publishes the smaller roster without clearing the other
   players' ready flags;
7. a result-screen departure returns the remaining roster to `LOBBY` with the
   same room settings and reset readiness; and
8. during countdown or match, two or more remaining/validly-reserved players
   continue under the existing population policy. If the remaining population
   can no longer reach the two-player minimum, the match becomes `NO_CONTEST`
   immediately and the remaining roster returns to the lobby.

The leaving client clears only the departed room's resume token and last-room
pointer after a successful acknowledgement, then resets its canonical room,
match, and session state to `LANDING`. A rejected or timed-out request leaves
the current session intact and uses the existing recoverable error surface.

## Match rules and pacing

`MatchState.remainingMs` starts at `settings.durationMs`. A credited knockout
finishes the match when that player's score reaches
`settings.knockoutTarget`. Self-falls still award no point. Countdown, normal
knockout return, overload reset, ties, and next-knockout sudden death keep their
approved behavior.

Contraction milestones use exact proportions of the selected duration, derived
by one shared pure helper:

| Milestone | Ratio of duration remaining | 90 s | 120 s | 180 s |
| --- | ---: | ---: | ---: | ---: |
| Warning begins | `13 / 20` | 58.5 s | 78 s | 117 s |
| Contraction begins | `5 / 8` | 56.25 s | 75 s | 112.5 s |
| Minimum arena | `1 / 3` | 30 s | 40 s | 60 s |

The existing 120-second pacing therefore remains behaviorally identical at
78/75/40 seconds. The same shared timing helper drives authoritative platform
progress, ArenaView warning state, and HUD copy; no client duplicates the
ratios.

## Lobby and match UI

The lobby adds one compact **Oda Ayarları** section inside the incumbent panel:

- host: enabled selects labelled **Maç süresi** and **Kazanma hedefi**;
- guest: the same values remain visible but read-only;
- duration labels: **90 sn**, **2 dk**, **3 dk**;
- target labels: **3 knockout**, **5 knockout**, **7 knockout**,
  **10 knockout**;
- default values appear immediately when the room is created.

The controls use the existing quiet lobby visual system, native focus behavior,
and current error surface. No modal or secondary settings screen is added.
While an acknowledged update is pending, the host controls are disabled to
prevent conflicting submissions. A failed update leaves the last authoritative
values visible and uses the existing recoverable server-error presentation.

The match HUD keeps the authoritative timer and adds a compact
**İlk N knockout** rule label. Result/rematch continues to show real scores;
returning to the lobby exposes the editable settings again.

The existing top bar shows one quiet **Odadan Çık** action whenever the client
owns a room session, so the same exit remains available in lobby, match, and
result without duplicating controls across screens. It is disabled while
another acknowledged action is pending and disappears immediately after a
successful leave.

## Interfaces

The shared protocol adds two strict requests and extends existing state:

```ts
type RoomSettingsPayload = RoomSettings;

type RoomLeavePayload = Record<string, never>;

type RoomState = Readonly<{
  // existing fields
  settings: RoomSettings;
}>;

type MatchSnapshot = Readonly<{
  // existing fields
  settings: RoomSettings;
}>;
```

`GameClient.setRoomSettings(settings)` emits `lobby:settings` and resolves only
after the server acknowledgement. The game store exposes one corresponding
action and otherwise treats `RoomState` and `MatchSnapshot` as the source of
truth. `GameClient.leaveRoom()` emits `room:leave`; the store clears persisted
room credentials and transitions to `LANDING` only after a successful
acknowledgement. No test-only network route or production bypass is added.

## Error and lifecycle behavior

- A guest update returns `NOT_HOST` and publishes no state change.
- An update outside `LOBBY` returns `INVALID_PHASE`.
- Unsupported values or extra payload fields fail protocol validation.
- A real settings change resets all ready flags; an identical update does not.
- Reconnect and host migration preserve the pair.
- Returning to the lobby, direct rematch, and repeated rematches preserve the
  pair until a current host changes it in the lobby.
- Room destruction discards the settings with the room; there is no disk or
  account persistence.
- Explicit leave is accepted in every room phase, invalidates resume authority,
  removes the socket from the old room channel, and never creates a reconnect
  reservation for the leaver.
- Host leave migrates ownership; last-player leave destroys the room.
- Active-match leave continues with a viable population or immediately follows
  the existing pause/no-contest population rule. Result leave returns remaining
  players to the lobby.

## Verification

### Shared and server tests

- strict payload accepts every supported pair and rejects unsupported or extra
  values;
- room creation publishes the default pair;
- only the current host can update in `LOBBY`;
- a real change resets every ready flag and an identical update is a no-op;
- reconnect, host migration, lobby return, and rematch retain settings;
- 90/120/180-second matches seed the exact duration and milestones;
- scores finish at 3/5/7/10 while self-falls remain uncredited;
- every snapshot carries the immutable match settings.
- explicit leave removes player/session/match ownership atomically;
- host migration, empty-room destruction, active 3+ continuation,
  two-player no-contest, result-to-lobby, and invalidated resume token behavior
  are covered.

### Client and UI tests

- GameClient emits the strict acknowledged event;
- host controls are enabled, guests see read-only values, pending mutation is
  disabled, and failures preserve authoritative values;
- changing either select calls one complete-pair action;
- ready-state reset is visible to every lobby client;
- HUD reads the snapshot target and shared proportional timing rather than
  global fixed values.
- successful leave clears only the departed room credentials and canonical
  state; failed leave preserves both;
- the top-bar leave action is shown on all room screens, hidden on landing, and
  disabled during pending work.

### Browser acceptance

In two isolated browser contexts, the host changes the room to 90 seconds and
three knockouts, the guest sees the same values, both ready flags clear after a
later settings change, and the host starts only after everyone readies again.
The match snapshot, timer, target label, contraction schedule, result, reconnect,
and rematch all retain the selected pair. A guest mutation attempt is rejected
without changing either screen.

The guest then uses **Odadan Çık** and returns to the landing screen while the
host sees the roster update without refreshing. The same live socket can join
again as a new session. A second room proves host departure transfers ownership
and the new host retains the configured settings.

The representative performance test remains one real browser rendering the
complete eight-player match while seven lightweight network participants supply
server and input load. Room settings do not reintroduce multiple local renderer
processes into that LAN performance boundary.

## Acceptance criteria

1. Only the current host can select an exact supported pair in `LOBBY`.
2. Every participant sees the same authoritative pair, and a real change clears
   every ready flag.
3. Match duration, knockout victory, contraction, HUD, result, reconnect, and
   rematch all use the match's immutable settings.
4. Default rooms behave exactly as 120 seconds, first to five, and 78/75/40
   contraction.
5. Unit, protocol, server, client, UI, integration, two-browser E2E, load,
   representative performance, build, lint, and typecheck gates pass on the
   same accepted commit.
6. `Odadan Çık` works from lobby, match, and result, clears the leaving session,
   preserves a viable room, migrates host authority, and destroys an empty
   room.
