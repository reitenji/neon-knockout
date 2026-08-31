# Neon Knockout Room Settings

**Status:** Approved for implementation planning
**Date:** 2026-08-31
**Scope:** Existing Knockout FFA lobby and match only

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

## Non-goals

- Free-form numeric inputs, arbitrary rules, per-player settings, teams, modes,
  maps, bots, hazards, pickups, WAN matchmaking, persistence, or accounts.
- Changing settings during countdown, regulation, sudden death, or result.
- Adding a compatibility layer for clients that do not understand room
  settings.

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

## Interfaces

The shared protocol adds one strict request and extends existing state:

```ts
type RoomSettingsPayload = RoomSettings;

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
truth. No test-only network route or production bypass is added.

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

### Client and UI tests

- GameClient emits the strict acknowledged event;
- host controls are enabled, guests see read-only values, pending mutation is
  disabled, and failures preserve authoritative values;
- changing either select calls one complete-pair action;
- ready-state reset is visible to every lobby client;
- HUD reads the snapshot target and shared proportional timing rather than
  global fixed values.

### Browser acceptance

In two isolated browser contexts, the host changes the room to 90 seconds and
three knockouts, the guest sees the same values, both ready flags clear after a
later settings change, and the host starts only after everyone readies again.
The match snapshot, timer, target label, contraction schedule, result, reconnect,
and rematch all retain the selected pair. A guest mutation attempt is rejected
without changing either screen.

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
