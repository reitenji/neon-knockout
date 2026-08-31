# Room Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add host-controlled 90/120/180-second and 3/5/7/10-knockout room settings that remain server-authoritative across the full LAN lobby, match, reconnect, result, and rematch lifecycle.

**Architecture:** A strict shared settings contract is owned by `RoomManager`, copied into immutable match state at start, and published in both `RoomState` and `MatchSnapshot`. Server simulation and client presentation use one proportional timing helper; the lobby submits complete setting pairs through one acknowledged Socket.IO event and never applies optimistic rule state.

**Tech Stack:** TypeScript, Node.js 20+, Socket.IO, Zod, React 19, Phaser 4, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-room-settings-design.md`

## Global Constraints

- [ ] Keep the existing Knockout FFA mode and its approved combat mechanics unchanged.
- [ ] Accept only duration values `90_000 | 120_000 | 180_000` and knockout targets `3 | 5 | 7 | 10`.
- [ ] Keep defaults at 120 seconds and five knockouts.
- [ ] Treat `Room.settings` as the lobby source of truth and the copied `MatchState.settings` as immutable match truth.
- [ ] Permit settings writes only from the current host while the room is in `LOBBY`.
- [ ] Reset every player's ready flag on a real settings change; preserve ready flags for an identical no-op.
- [ ] Preserve settings through reconnect, host migration, result, return-to-lobby, direct rematch, and repeated rematches.
- [ ] Use the shared 13/20, 5/8, and 1/3 timing ratios on server, HUD, and Phaser presentation.
- [ ] Do not add free numeric inputs, modes, maps, persistence, compatibility fallbacks, or test-only production routes.
- [ ] Write a failing behavioral test before each production change, observe the intended RED failure, then implement the minimum GREEN change.
- [ ] After each task, commit only that task's owned files and record focused command output in the SDD report/ledger.

---

## Task 1: Shared settings contract and strict protocol

**Files:**

- Create: `src/shared/roomSettings.ts`
- Create: `src/shared/roomSettings.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/protocol.test.ts`

### Step 1: Write failing pure-rule tests

- [ ] Add tests proving the exact supported option arrays and default pair.
- [ ] Add table-driven timing tests for all three durations:

| Duration | Warning | Contraction start | Minimum |
| ---: | ---: | ---: | ---: |
| 90,000 | 58,500 | 56,250 | 30,000 |
| 120,000 | 78,000 | 75,000 | 40,000 |
| 180,000 | 117,000 | 112,500 | 60,000 |

- [ ] Assert the helper returns a new read-only timing value without mutating its input.
- [ ] Run and observe RED:

```bash
npx vitest run src/shared/roomSettings.test.ts --maxWorkers=1
```

Expected RED: module/exports do not exist.

### Step 2: Implement the smallest shared rule module

- [ ] Define these exact public shapes:

```ts
export const MATCH_DURATION_OPTIONS = [90_000, 120_000, 180_000] as const;
export type MatchDurationMs = (typeof MATCH_DURATION_OPTIONS)[number];

export const KNOCKOUT_TARGET_OPTIONS = [3, 5, 7, 10] as const;
export type KnockoutTarget = (typeof KNOCKOUT_TARGET_OPTIONS)[number];

export type RoomSettings = Readonly<{
  durationMs: MatchDurationMs;
  knockoutTarget: KnockoutTarget;
}>;

export type MatchTiming = Readonly<{
  regulationMs: number;
  contractionWarningRemainingMs: number;
  contractionStartRemainingMs: number;
  contractionMinimumRemainingMs: number;
}>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = Object.freeze({
  durationMs: 120_000,
  knockoutTarget: 5
});

export function matchTimingFor(durationMs: MatchDurationMs): MatchTiming;
```

- [ ] Calculate timings only from `durationMs` using `13 / 20`, `5 / 8`, and `1 / 3`.
- [ ] Keep validation in the Zod protocol schema; do not add duplicate runtime guard helpers unless a production caller actually needs them.
- [ ] Re-run the focused test and observe GREEN.

### Step 3: Write failing strict-protocol tests

- [ ] Add a table that accepts all 12 supported duration/target pairs.
- [ ] Reject `100_000` duration, target `8`, missing fields, and extra fields such as `map`.
- [ ] Prove the accepted object contains the complete pair.
- [ ] Run and observe RED:

```bash
npx vitest run src/shared/protocol.test.ts -t "room settings" --maxWorkers=1
```

Expected RED: `lobbySettingsSchema` and `lobby:settings` do not exist.

### Step 4: Add the acknowledged protocol event

- [ ] Export a strict `lobbySettingsSchema` containing numeric literal unions.
- [ ] Export `LobbySettingsPayload = z.infer<typeof lobbySettingsSchema>`.
- [ ] Add:

```ts
'lobby:settings': (
  payload: LobbySettingsPayload,
  acknowledge: (ack: Ack<null>) => void
) => void;
```

- [ ] Re-run both focused files and observe GREEN:

```bash
npx vitest run src/shared/roomSettings.test.ts src/shared/protocol.test.ts --maxWorkers=1
```

### Step 5: Commit Task 1

```bash
git add src/shared/roomSettings.ts src/shared/roomSettings.test.ts src/shared/protocol.ts src/shared/protocol.test.ts
git commit -m "feat: define authoritative room settings"
```

---

## Task 2: Immutable match settings and authoritative simulation

**Files:**

- Modify: `src/shared/model.ts`
- Modify: `src/server/game/state.ts`
- Modify: `src/server/game/simulation.ts`
- Modify: `src/server/game/simulation.test.ts`
- Modify direct `createMatchState` test callers:
  - `src/shared/protocol.test.ts`
  - `src/server/game/combat.test.ts`
  - `src/server/game/combatResolution.test.ts`
  - `src/server/game/movement.test.ts`
  - `src/server/game/projectiles.test.ts`
- Modify direct `MatchSnapshot` test fixtures only where TypeScript requires `settings`.

### Step 1: Write failing simulation tests

- [ ] Change test setup to pass an explicit settings value to `createMatchState`.
- [ ] Add table-driven tests proving `remainingMs` starts at 90,000, 120,000, and 180,000.
- [ ] Add table-driven score tests proving the match resolves exactly at targets 3, 5, 7, and 10.
- [ ] Keep the self-fall test and prove it still produces no credited score.
- [ ] Prove `snapshotMatch(state).settings` equals the seeded pair and does not change when the original caller object is later reassigned or mutated through a mutable test cast.
- [ ] Prove each duration enters warning/start/minimum contraction at the shared helper's milestones.
- [ ] Run and observe RED:

```bash
npx vitest run src/server/game/simulation.test.ts --maxWorkers=1
```

Expected RED: `MatchState` and `createMatchState` do not accept settings and simulation still reads fixed `GAME` values.

### Step 2: Extend match model and state

- [ ] Add required `settings: RoomSettings` to `MatchSnapshot` after `platformProgress`.
- [ ] Add required `settings: RoomSettings` to internal `MatchState`.
- [ ] Change the constructor to:

```ts
export function createMatchState(
  playerSeeds: readonly MatchPlayerSeed[],
  seed: number,
  settings: RoomSettings
): MatchState
```

- [ ] Copy the pair into match state and seed `remainingMs` from `settings.durationMs`.
- [ ] Update every direct test caller to pass `DEFAULT_ROOM_SETTINGS` unless the test specifically exercises another pair.

### Step 3: Drive scoring, contraction, and snapshots from match truth

- [ ] In contraction logic, compute `const timing = matchTimingFor(state.settings.durationMs)` once per relevant step and remove reads of fixed contraction thresholds.
- [ ] Resolve score victory using `state.settings.knockoutTarget`.
- [ ] Serialize a fresh settings pair in every `MatchSnapshot`.
- [ ] Do not read lobby state from simulation.
- [ ] Run focused GREEN:

```bash
npx vitest run src/server/game/simulation.test.ts src/server/game/combat.test.ts src/server/game/combatResolution.test.ts src/server/game/movement.test.ts src/server/game/projectiles.test.ts src/shared/protocol.test.ts --maxWorkers=1
npm run typecheck
```

### Step 4: Commit Task 2

```bash
git add src/shared/model.ts src/server/game/state.ts src/server/game/simulation.ts src/server/game/simulation.test.ts src/shared/protocol.test.ts src/server/game/combat.test.ts src/server/game/combatResolution.test.ts src/server/game/movement.test.ts src/server/game/projectiles.test.ts
git commit -m "feat: apply room settings to match rules"
```

---

## Task 3: Room ownership, authorization, and Socket.IO lifecycle

**Files:**

- Modify: `src/server/rooms/roomManager.ts`
- Modify: `src/server/rooms/roomManager.test.ts`
- Modify: `src/server/network/socketHandlers.ts`
- Modify: `tests/integration/socketFlow.test.ts`

### Step 1: Write failing room-domain tests

- [ ] Prove a newly created room publishes `DEFAULT_ROOM_SETTINGS`.
- [ ] Prove the current host can replace the full pair in `LOBBY`.
- [ ] Prove a real change clears every player's ready flag before the next published room state.
- [ ] Prove submitting the identical pair is a no-op that leaves readiness unchanged.
- [ ] Prove a guest gets `NOT_HOST` and no room state changes.
- [ ] Prove host writes in `COUNTDOWN`, `MATCH`, or `RESULT` get `INVALID_PHASE`.
- [ ] Prove settings survive current host disconnect/migration, former-host resume, return-to-lobby, direct rematch, and repeated rematches.
- [ ] Prove `MATCH_STARTED` carries the copied pair.
- [ ] Run and observe RED:

```bash
npx vitest run src/server/rooms/roomManager.test.ts -t "settings" --maxWorkers=1
```

### Step 2: Implement room-owned settings

- [ ] Add `settings: RoomSettings` to private `Room` and required `RoomState`.
- [ ] Seed a copied default pair in `createRoom`.
- [ ] Add:

```ts
setRoomSettings(connectionId: string, settings: RoomSettings): void
```

- [ ] Resolve membership through the existing connection lookup.
- [ ] Check `LOBBY` before mutation and current `hostPlayerId` before authorization.
- [ ] Return immediately for a behaviorally identical pair.
- [ ] For a real change, assign a copied pair, clear all ready flags, and publish one room state.
- [ ] Pass `room.settings` to `createMatchState` in `startMatch`.
- [ ] Include a copied pair in `publishRoom`.
- [ ] Leave reset/rematch code free of settings reassignment so room settings naturally persist.

### Step 3: Write failing socket integration tests

- [ ] Add an acknowledged `lobby:settings` helper to the integration test only.
- [ ] Prove host update acknowledgement succeeds and both clients receive the same pair.
- [ ] Prove a later real update clears both ready flags.
- [ ] Prove guest update acknowledgement is `NOT_HOST` and neither client receives a changed pair.
- [ ] Prove unsupported/extra fields receive `INVALID_PAYLOAD` through the existing schema handler.
- [ ] Run and observe RED:

```bash
npx vitest run tests/integration/socketFlow.test.ts -t "room settings" --maxWorkers=1
```

### Step 4: Wire the validated event

- [ ] Register `lobby:settings` beside existing lobby actions in `registerSocketHandlers`.
- [ ] Parse with `lobbySettingsSchema` and call `manager.setRoomSettings(socket.id, payload)` through the existing acknowledged-handler path.
- [ ] Do not add a fire-and-forget alternative.
- [ ] Run focused GREEN:

```bash
npx vitest run src/server/rooms/roomManager.test.ts tests/integration/socketFlow.test.ts --maxWorkers=1
npm run typecheck
```

### Step 5: Commit Task 3

```bash
git add src/server/rooms/roomManager.ts src/server/rooms/roomManager.test.ts src/server/network/socketHandlers.ts tests/integration/socketFlow.test.ts
git commit -m "feat: synchronize host room settings"
```

---

## Task 4: Client transport and authoritative store behavior

**Files:**

- Modify: `src/client/network/GameClient.ts`
- Modify: `src/client/network/GameClient.test.ts`
- Modify: `src/client/state/gameStore.ts`
- Modify: `src/client/state/gameStore.test.ts`

### Step 1: Write failing transport/store tests

- [ ] Prove `setRoomSettings({ durationMs: 90_000, knockoutTarget: 3 })` emits exactly one acknowledged `lobby:settings` event with the complete pair.
- [ ] Prove store pending action becomes `settings` while acknowledgement is unresolved and then clears.
- [ ] Prove the displayed/canonical `room.settings` remains unchanged until a server `room:state` arrives; no optimistic replacement is allowed.
- [ ] Prove a failed acknowledgement preserves the last authoritative pair and sets `errorAction: 'settings'`.
- [ ] Run and observe RED:

```bash
npx vitest run src/client/network/GameClient.test.ts src/client/state/gameStore.test.ts -t "room settings" --maxWorkers=1
```

### Step 2: Implement the client mutation path

- [ ] Add `setRoomSettings(settings: RoomSettings): Promise<Ack<null>>` to `GameClient` and `SocketGameClient`.
- [ ] Add `'settings'` to `PendingAction`.
- [ ] Add `actions.setRoomSettings(settings: RoomSettings): Promise<void>`.
- [ ] Use the existing `runAcknowledgedAction('settings', ...)` path.
- [ ] Do not patch `state.room` inside the action; wait for authoritative `room:state`.
- [ ] Run focused GREEN and typecheck:

```bash
npx vitest run src/client/network/GameClient.test.ts src/client/state/gameStore.test.ts --maxWorkers=1
npm run typecheck
```

### Step 3: Commit Task 4

```bash
git add src/client/network/GameClient.ts src/client/network/GameClient.test.ts src/client/state/gameStore.ts src/client/state/gameStore.test.ts
git commit -m "feat: expose room settings client action"
```

---

## Task 5: Lobby controls and host/guest UX

**Files:**

- Modify: `src/client/App.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/ui/LobbyScreen.tsx`
- Modify: `src/client/ui/LobbyScreen.test.tsx`
- Modify: `src/client/styles/layout.css`

### Step 1: Write failing UI behavior tests

- [ ] Prove the host sees enabled native selects labelled `Maç süresi` and `Kazanma hedefi` with current authoritative values.
- [ ] Prove a guest sees the same values but both selects are disabled.
- [ ] Prove `pendingAction === 'settings'` disables both controls.
- [ ] Prove changing duration from 120 to 90 submits exactly `{ durationMs: 90_000, knockoutTarget: 5 }`.
- [ ] Prove changing target from 5 to 7 submits exactly `{ durationMs: 120_000, knockoutTarget: 7 }`.
- [ ] Prove a settings failure uses the existing recoverable inline error surface.
- [ ] Run and observe RED:

```bash
npx vitest run src/client/ui/LobbyScreen.test.tsx src/client/App.test.tsx -t "room settings" --maxWorkers=1
```

### Step 2: Build the compact lobby section

- [ ] Extend `LobbyScreenProps` with:

```ts
onSetRoomSettings: (settings: RoomSettings) => Promise<void>;
```

- [ ] Wire `store.actions.setRoomSettings` from `App`.
- [ ] Add one `Oda Ayarları` section inside the existing lobby panel, before the player list.
- [ ] Use native labelled selects with exact options:
  - `90 sn`, `2 dk`, `3 dk`
  - `3 knockout`, `5 knockout`, `7 knockout`, `10 knockout`
- [ ] Each change submits one full pair made from the selected value and the other current authoritative value.
- [ ] Disable both selects for non-hosts, missing self player, or any pending action; set `aria-busy` for the settings action.
- [ ] Include `settings` in the existing lobby error-action filter.
- [ ] Style the section with the existing quiet panel, label, focus-ring, spacing, and responsive grammar. Do not add a modal, decorative card stack, or colored ground effects.
- [ ] Run focused GREEN:

```bash
npx vitest run src/client/ui/LobbyScreen.test.tsx src/client/App.test.tsx --maxWorkers=1
npm run typecheck
```

### Step 3: Commit Task 5

```bash
git add src/client/App.tsx src/client/App.test.tsx src/client/ui/LobbyScreen.tsx src/client/ui/LobbyScreen.test.tsx src/client/styles/layout.css
git commit -m "feat: add host room settings controls"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated client files.

---

## Task 6: HUD and Phaser timing presentation

**Files:**

- Modify: `src/client/ui/MatchHud.tsx`
- Modify: `src/client/ui/MatchHud.test.tsx`
- Modify: `src/client/game/phaser/arenaVisualPlan.ts`
- Modify: `src/client/game/phaser/arenaVisualPlan.test.ts`
- Modify: `src/client/game/phaser/ArenaView.ts`
- Modify: `src/client/game/phaser/ArenaView.test.ts`

### Step 1: Write failing presentation tests

- [ ] Prove HUD renders `İlk 3 knockout` and `İlk 10 knockout` from snapshot settings.
- [ ] Prove the opening `FIGHT` window is relative to `snapshot.settings.durationMs` for both 90 and 180 seconds.
- [ ] Prove HUD warning begins at 58,500 for 90 seconds and 117,000 for 180 seconds.
- [ ] Prove `arenaVisualPlan` warning lead reaches its boundaries using the shared helper, including the 180-second 117,000/112,500 window.
- [ ] Prove `ArenaView` redraw/visibility changes at the proportional warning onset and not at the old fixed 78-second threshold.
- [ ] Run and observe RED:

```bash
npx vitest run src/client/ui/MatchHud.test.tsx src/client/game/phaser/arenaVisualPlan.test.ts src/client/game/phaser/ArenaView.test.ts -t "room settings|proportional|knockout target" --maxWorkers=1
```

### Step 2: Replace presentation globals

- [ ] Read `snapshot.settings` in `MatchHud` and render the compact target label.
- [ ] Use `matchTimingFor(snapshot.settings.durationMs)` for opening/warning/minimum calculations.
- [ ] Pass settings-derived timing into `arenaVisualPlan` or let it derive from the snapshot duration; do not duplicate ratios.
- [ ] Use the same helper in `ArenaView` warning visibility.
- [ ] Preserve existing animation, attack feedback, accessibility, and local-player marker behavior.
- [ ] Run focused GREEN:

```bash
npx vitest run src/client/ui/MatchHud.test.tsx src/client/game/phaser/arenaVisualPlan.test.ts src/client/game/phaser/ArenaView.test.ts --maxWorkers=1
npm run typecheck
```

### Step 3: Commit Task 6

```bash
git add src/client/ui/MatchHud.tsx src/client/ui/MatchHud.test.tsx src/client/game/phaser/arenaVisualPlan.ts src/client/game/phaser/arenaVisualPlan.test.ts src/client/game/phaser/ArenaView.ts src/client/game/phaser/ArenaView.test.ts
git commit -m "feat: present configured match rules"
```

---

## Task 7: Two-browser acceptance, cleanup, and delivery proof

**Files:**

- Modify: `tests/e2e/fixtures.ts`
- Modify: `tests/e2e/knockout.spec.ts`
- Modify: `tests/load/eightClients.test.ts` only if required for the new required state field
- Modify: `tests/e2e/performance.spec.ts` only if required for the new required state field
- Modify: `src/shared/constants.ts`
- Modify: `README.md`
- Modify: `.superpowers/sdd/2026-08-31-room-settings/progress.md`
- Create: `.superpowers/sdd/2026-08-31-room-settings/task-7-report.md`

### Step 1: Add failing real-browser acceptance

- [ ] In two isolated browser contexts, create and join a room.
- [ ] As host, select 90 seconds and three knockouts; prove guest selects show the same pair.
- [ ] Ready both players, change one setting, and prove both ready indicators reset before start.
- [ ] Prove the host cannot start until both players ready again.
- [ ] Prove the guest controls remain read-only and no settings mutation is emitted from guest UI interaction. Keep the hostile guest protocol mutation proof in the Socket.IO integration test, where the acknowledgement can be asserted without adding a test-only browser hook.
- [ ] Start the match and prove the HUD shows the selected duration/target.
- [ ] Reconnect one client and prove the pair remains.
- [ ] Reach result through authoritative test choreography, direct-rematch, and prove the same pair remains in the next match snapshot/HUD.
- [ ] Return to lobby in a separate branch of the scenario and prove the controls retain the pair and are editable by the current host.
- [ ] Run and observe RED:

```bash
npm run build
npx playwright test tests/e2e/knockout.spec.ts -g "room settings" --workers=1
```

### Step 2: Make fixture support minimal

- [ ] Add one small `applyRoomSettings` helper or one optional complete-pair parameter to the existing two-player fixture.
- [ ] Do not create a parallel room/match harness.
- [ ] Keep the test on real DOM controls for host behavior and the production acknowledged client path for guest authorization rejection.
- [ ] Re-run the focused E2E until it passes twice consecutively.

### Step 3: Remove obsolete fixed rule constants

- [ ] Remove `GAME.regulationMs`, `GAME.targetScore`, `GAME.contractionWarningRemainingMs`, `GAME.contractionStartRemainingMs`, and `GAME.contractionMinimumRemainingMs`.
- [ ] Replace remaining test assertions with `DEFAULT_ROOM_SETTINGS` or `matchTimingFor`.
- [ ] Prove no production or test consumer remains:

```bash
rg -n "regulationMs|targetScore|contractionWarningRemainingMs|contractionStartRemainingMs|contractionMinimumRemainingMs" src tests README.md
```

Expected: only `MatchTiming` field names and helper-driven local variables remain; no `GAME.<removed field>` reference or hardcoded default-rule loop remains.

### Step 4: Update user-facing documentation

- [ ] Document host-only room settings, exact choices/defaults, ready reset, and persistence in `README.md`.
- [ ] Keep WASD/J/K/Space controls and corrected one-renderer LAN performance methodology intact.
- [ ] Do not claim WAN, mobile, bots, maps, or other modes.

### Step 5: Run the complete verification matrix

- [ ] Focused room settings:

```bash
npx vitest run src/shared/roomSettings.test.ts src/shared/protocol.test.ts src/server/game/simulation.test.ts src/server/rooms/roomManager.test.ts src/client/network/GameClient.test.ts src/client/state/gameStore.test.ts src/client/ui/LobbyScreen.test.tsx src/client/ui/MatchHud.test.tsx src/client/game/phaser/arenaVisualPlan.test.ts src/client/game/phaser/ArenaView.test.ts tests/integration/socketFlow.test.ts --maxWorkers=1
```

- [ ] Full non-browser gate:

```bash
npm run verify
```

- [ ] Full browser gate:

```bash
npm run test:e2e
```

- [ ] Re-run the representative performance gate exactly as one real renderer plus seven active lightweight clients:

```bash
npx playwright test tests/e2e/performance.spec.ts --workers=1
```

- [ ] Confirm eight-client load, real J/K/Space input semantics, server snapshots, score list of eight, no page/console errors, and the accepted frame-time threshold.
- [ ] Run the room-settings E2E a second consecutive time to rule out a timing-only pass.

### Step 6: Review and publish

- [ ] Record the accepted commit, exact commands, counts, timings, and any environmental boundary in `task-7-report.md` and the SDD ledger.
- [ ] Request independent spec-compliance review, then independent code-quality review; implement findings through the assigned worker and repeat focused gates.
- [ ] Request a final whole-branch review against the approved room-settings spec and existing combat spec.
- [ ] Confirm `git status --short` contains no unreviewed artifacts such as `output/` or `.playwright-cli/`.
- [ ] Commit:

```bash
git add src/shared/constants.ts README.md tests/e2e/fixtures.ts tests/e2e/knockout.spec.ts .superpowers/sdd/2026-08-31-room-settings
git commit -m "test: prove configurable LAN matches"
```

- [ ] Merge the accepted feature branch into `main` without discarding user changes.
- [ ] Push `main` to `origin` and verify local `main`, `origin/main`, and the reported accepted commit are equal.
- [ ] Verify the public repository page and clone URL remain reachable.
- [ ] Start the built server on `0.0.0.0`, verify the listener owner and HTTP status, then perform the final same-machine browser smoke before reporting LAN instructions.

## Definition of Done

- [ ] Host-only settings are authoritative and strict.
- [ ] Every client sees one synchronized pair and real changes reset readiness.
- [ ] Duration, score victory, contraction, HUD, reconnect, result, and rematch use the copied match pair.
- [ ] Defaults remain behaviorally identical to the former 120-second/first-to-five rules.
- [ ] No obsolete global rule constant or optimistic client settings state remains.
- [ ] Focused, full, load, two-browser, representative performance, lint, typecheck, and build gates pass on the same accepted commit.
- [ ] Reviewed code is merged and pushed to public `main`, and the LAN server is reachable.
