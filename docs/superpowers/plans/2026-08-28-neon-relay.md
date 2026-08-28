# Neon Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a polished, server-authoritative 2–8-player LAN arena game that friends join from desktop browsers without installing a client.

**Architecture:** A single TypeScript npm package builds a React/Vite client and a bundled Node/Express/Socket.IO server. Pure shared constants and a deterministic server simulation define gameplay; room/session management owns lifecycle and reconnection; a Canvas client predicts the local player and interpolates canonical snapshots while React owns menus and overlays.

**Tech Stack:** Node.js 20+, TypeScript, React, Vite, Express, Socket.IO, Zod, Vitest, Testing Library, Playwright, ESLint, tsup

**Spec:** `docs/superpowers/specs/2026-08-28-neon-relay-design.md`

## Global Constraints

- Desktop and laptop browsers only; do not add mobile or touch controls.
- Support 2–8 players, multiple in-memory rooms, four-character room codes, and no persistent services.
- The server is authoritative for movement, collisions, tackles, cores, score, time, and match transitions.
- Use a fixed 30 Hz simulation and 20 Hz snapshot broadcast with deterministic phase and stable-ID ordering.
- Bind production hosting to `0.0.0.0`, default port `4173`, and print localhost plus RFC1918 IPv4 URLs.
- Keep dependencies to those named above; do not add a game engine, state library, CSS framework, database, or asset pipeline.
- Product copy is Turkish; source identifiers are English.
- Scope excludes bots, chat, spectators, weapons, damage, accounts, progression, persistence, and WAN traversal.
- Every task follows red-green-refactor and ends with focused passing tests and a commit.

---

## File Map

### Project and shared contract

- `package.json` — scripts and dependency manifest.
- `package-lock.json` — reproducible npm resolution.
- `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `playwright.config.ts` — build and verification configuration.
- `index.html`, `src/client/main.tsx` — browser entry.
- `src/shared/model.ts` — stable domain and protocol TypeScript types.
- `src/shared/constants.ts` — exact game constants and symmetric arena geometry.
- `src/shared/protocol.ts` — Zod schemas plus typed Socket.IO event maps.
- `src/shared/names.ts` — player-name and room-code normalization.

`vite.config.ts` must set `build.outDir` to `dist/client`, keep `emptyOutDir: false`, and proxy both `/socket.io` and `/health` to `http://127.0.0.1:4173` during development. This keeps browser traffic same-origin at Vite's development URL while preserving the production output contract.

### Authoritative server

- `src/server/game/state.ts` — canonical match-state creation and snapshots.
- `src/server/game/geometry.ts` — pure collision and movement helpers.
- `src/server/game/simulation.ts` — fixed-step gameplay phase ordering.
- `src/server/rooms/roomManager.ts` — room, session, host, reconnect, lobby, match, and rematch lifecycle.
- `src/server/rooms/domainError.ts` — typed safe domain failures.
- `src/server/network/createGameServer.ts` — composable HTTP/Socket.IO server and direct test harness.
- `src/server/network/socketHandlers.ts` — schema-validated event wiring and rate limits.
- `src/server/runtime/lanAddresses.ts` — interface discovery and startup presentation.
- `src/server/main.ts` — environment parsing, server startup, signals, and graceful close.

### Browser client

- `src/client/network/GameClient.ts` — typed Socket.IO wrapper and acknowledgements.
- `src/client/state/gameStore.ts` — external store for connection, room, match, and errors.
- `src/client/state/useGameStore.ts` — React `useSyncExternalStore` bridge.
- `src/client/App.tsx` — screen router and app shell.
- `src/client/ui/LandingScreen.tsx`, `LobbyScreen.tsx`, `ResultScreen.tsx` — primary flows.
- `src/client/ui/ConnectionOverlay.tsx`, `TopBar.tsx`, `ToastRegion.tsx` — shared status UI.
- `src/client/game/keyboard.ts` — held-button sampling and dash edge capture.
- `src/client/game/prediction.ts` — input buffer, reconciliation, and remote interpolation.
- `src/client/game/renderer.ts` — Canvas-only arena renderer.
- `src/client/game/GameCanvas.tsx` — browser render/input lifecycle.
- `src/client/game/audio.ts` — generated Web Audio cues and persistent mute.
- `src/client/styles/tokens.css`, `layout.css`, `game.css` — visual system and responsive desktop layout.

### Verification and docs

- Co-located `*.test.ts` / `*.test.tsx` — unit and component tests.
- `tests/integration/socketFlow.test.ts` — real two-client Socket.IO flow.
- `tests/load/eightClients.test.ts` — bounded eight-client soak smoke.
- `tests/e2e/fixtures.ts`, `tests/e2e/neon-relay.spec.ts` — in-process server browser flow and screenshots.
- `README.md` — host, join, firewall, controls, troubleshooting, and verification instructions.

---

### Task 1: Project Foundation and Shared Contract

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `src/client/main.tsx`
- Create: `src/shared/model.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/protocol.ts`
- Create: `src/shared/names.ts`
- Test: `src/shared/names.test.ts`
- Test: `src/shared/protocol.test.ts`

**Interfaces:**
- Produces: `Team`, `Vec2`, `InputFrame`, `RoomState`, `MatchSnapshot`, `GameEvent`, `ClientToServerEvents`, `ServerToClientEvents`, `Ack<T>`, `GAME`, `ARENA`, `normalizePlayerName(value)`, `normalizeRoomCode(value)`.
- Consumes: no application code.

- [ ] **Step 1: Scaffold the package and verification commands**

Create a private ESM package with these scripts and install the named packages so npm writes the lockfile:

```json
{
  "name": "neon-relay",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "concurrently -k \"tsx watch src/server/main.ts\" \"vite --host 0.0.0.0\"",
    "build:client": "vite build",
    "build:server": "tsup src/server/main.ts --format esm --platform node --out-dir dist/server --clean false",
    "build": "rimraf dist && npm run build:client && npm run build:server",
    "start": "node dist/server/main.js",
    "lan": "npm run build && npm start",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "lint": "eslint .",
    "test": "vitest run",
    "test:e2e": "npm run build && playwright test",
    "verify": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

Run:

```bash
npm install react react-dom express socket.io socket.io-client zod
npm install -D typescript @types/node @types/express @types/react @types/react-dom vite @vitejs/plugin-react tsup tsx concurrently rimraf vitest jsdom @testing-library/react @testing-library/jest-dom eslint @eslint/js globals typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh @playwright/test
```

Expected: `npm install` exits 0 and `package-lock.json` records all direct dependencies.

Configure Vite explicitly:

```ts
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: false },
  server: {
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:4173', ws: true },
      '/health': { target: 'http://127.0.0.1:4173' }
    }
  }
});
```

- [ ] **Step 2: Write failing normalization and protocol tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizePlayerName, normalizeRoomCode } from './names';
import { roomCreateSchema, matchInputSchema } from './protocol';

describe('shared input boundary', () => {
  it('normalizes visible names and rejects invalid lengths', () => {
    expect(normalizePlayerName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(() => normalizePlayerName('A')).toThrow('INVALID_NAME');
    expect(() => normalizePlayerName(`Ada\u0000<script>`)).toThrow('INVALID_NAME');
  });

  it('normalizes unambiguous room codes', () => {
    expect(normalizeRoomCode(' ab2z ')).toBe('AB2Z');
    expect(() => normalizeRoomCode('O0I1')).toThrow('INVALID_ROOM_CODE');
  });

  it('rejects client-owned position and non-boolean buttons', () => {
    expect(roomCreateSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(matchInputSchema.safeParse({ seq: 2, up: true, down: false, left: false, right: false, dash: false, x: 999 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ seq: 2, up: 1, down: false, left: false, right: false, dash: false }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the focused tests and confirm red**

Run: `npx vitest run src/shared/names.test.ts src/shared/protocol.test.ts`

Expected: FAIL because the shared modules do not exist.

- [ ] **Step 4: Implement the shared contract**

Define discriminated types and strict schemas. The essential signatures are:

```ts
export type Team = 'CYAN' | 'AMBER';
export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'MATCH' | 'RESULT';
export type MatchPhase = 'COUNTDOWN' | 'REGULATION' | 'PAUSED' | 'SUDDEN_DEATH' | 'FINISHED';
export type Vec2 = Readonly<{ x: number; y: number }>;
export type InputFrame = Readonly<{ seq: number; up: boolean; down: boolean; left: boolean; right: boolean; dash: boolean }>;
export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; recoverable: boolean } };
```

Export exact constants from the design:

```ts
export const GAME = Object.freeze({
  tickRate: 30,
  snapshotRate: 20,
  matchMs: 180_000,
  targetScore: 7,
  reconnectGraceMs: 20_000,
  maxPlayers: 8,
  playerRadius: 20,
  moveSpeed: 250,
  carrierMultiplier: 0.82,
  dashMultiplier: 2.35,
  dashMs: 160,
  dashCooldownMs: 1_800,
  tackleStunMs: 280,
  selfPickupLockMs: 650,
  coreReturnMs: 8_000,
  coreRespawnMs: 2_500
});
```

Use `z.object(...).strict()` for every client payload. `normalizePlayerName` must apply `NFKC`, strip/forbid Unicode control characters, collapse whitespace, and enforce 2–16 visible code points. `normalizeRoomCode` must uppercase and enforce `/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/`.

- [ ] **Step 5: Run focused tests, typecheck, and lint**

Run: `npm test -- src/shared && npm run typecheck && npm run lint`

Expected: PASS with no diagnostics.

- [ ] **Step 6: Commit the foundation**

```bash
git add package.json package-lock.json tsconfig*.json vite.config.ts vitest.config.ts eslint.config.js playwright.config.ts index.html src/shared src/client/main.tsx
git commit -m "build: scaffold Neon Relay shared contract"
```

### Task 2: Deterministic Authoritative Game Simulation

**Files:**
- Create: `src/server/game/state.ts`
- Create: `src/server/game/geometry.ts`
- Create: `src/server/game/simulation.ts`
- Test: `src/server/game/geometry.test.ts`
- Test: `src/server/game/simulation.test.ts`

**Interfaces:**
- Consumes: `Team`, `Vec2`, `InputFrame`, `GameEvent`, `MatchSnapshot`, `GAME`, `ARENA`.
- Produces: `createMatchState(players, seed)`, `stepMatch(state, inputs, stepMs)`, `snapshotMatch(state)`, `forceDelivery(state, team)`, `movePlayer(position, direction, elapsedMs, carrying)`, `pushCircle(position, direction, distance, radius, obstacles)`, `circleIntersectsRect(position, radius, rect)`, `separatePlayers(players)`.

- [ ] **Step 1: Write geometry tests**

Cover normalized diagonals, boundaries, barriers, stable pair separation, and incremental tackle push:

```ts
it('keeps diagonal movement at the base speed', () => {
  const next = movePlayer({ x: 100, y: 100 }, { x: 1, y: 1 }, 1_000, false);
  expect(Math.hypot(next.x - 100, next.y - 100)).toBeCloseTo(GAME.moveSpeed, 5);
});

it('stops tackle push at the last valid point before a wall', () => {
  const result = pushCircle({ x: 205, y: 300 }, { x: 1, y: 0 }, 52, 20, [{ x: 240, y: 250, width: 40, height: 100 }]);
  expect(result.x).toBe(219);
  expect(circleIntersectsRect(result, 20, { x: 240, y: 250, width: 40, height: 100 })).toBe(false);
});
```

- [ ] **Step 2: Write rule-engine tests**

Create fixtures with stable player IDs and assert the exact phase ordering:

```ts
it('awards a contested core by distance then stable player id', () => {
  const state = matchFixture({ players: [player('p-b', 'CYAN', 641, 360), player('p-a', 'AMBER', 639, 360)] });
  state.cores['core-1'] = looseCore('core-1', 640, 360);
  stepMatch(state, new Map(), 1000 / 30);
  expect(state.cores['core-1'].carrierId).toBe('p-a');
});

it('drops once, locks the former carrier, and credits one tackle', () => {
  const state = tackleFixture();
  const events = stepMatch(state, tackleInputs(), 1000 / 30);
  expect(events.filter((event) => event.type === 'TACKLE')).toHaveLength(1);
  expect(state.players['carrier'].carriedCoreId).toBeNull();
  expect(state.cores['core-1'].blockedPlayerId).toBe('carrier');
  expect(state.players['attacker'].stats.tackles).toBe(1);
});

it('enters sudden death on a tied expiry and next delivery wins', () => {
  const state = regulationFixture({ remainingMs: 1, score: { CYAN: 2, AMBER: 2 } });
  stepMatch(state, new Map(), 1000 / 30);
  expect(state.phase).toBe('SUDDEN_DEATH');
  forceDelivery(state, 'AMBER');
  expect(state.phase).toBe('FINISHED');
  expect(state.winner).toBe('AMBER');
});
```

Also test countdown lock, dash rising edge/cooldown, carrier slowdown, opposing-reactor no-op, core return, core respawn, target-score finish, timed winner, disconnect drop, pause timer, and same-tick delivery before expiry.

- [ ] **Step 3: Run the simulation tests and confirm red**

Run: `npx vitest run src/server/game`

Expected: FAIL because game modules do not exist.

- [ ] **Step 4: Implement canonical state and geometry**

Use integer tick ordering and bounded mutable state. Keep elapsed values in milliseconds and never read `Date.now()` or `Math.random()` inside simulation functions:

```ts
export function createMatchState(players: readonly MatchPlayerSeed[], seed: number): MatchState;
export function stepMatch(state: MatchState, inputs: ReadonlyMap<string, InputFrame>, stepMs: number): readonly GameEvent[];
export function snapshotMatch(state: MatchState): MatchSnapshot;
export function forceDelivery(state: MatchState, team: Team): readonly GameEvent[];
```

Implement the eleven spec phases in one visible `stepMatch` orchestration function: normalize inputs, start dashes, move players, resolve obstacle/boundary collisions, resolve player separation, resolve tackles, update dropped-core locks, resolve pickups, resolve reactor deliveries, advance timers/respawns, then evaluate match transitions. Each phase calls focused helpers; stable-sort player/core keys once per tick. Use the shared arena rectangles for both collision and later rendering. Never clone state in the 30 Hz loop; snapshots copy only public fields.

- [ ] **Step 5: Add deterministic replay coverage**

Run 900 ticks twice from separately created state using the same input frames and assert `snapshotMatch(first)` deeply equals `snapshotMatch(second)`. Include dash, pickup, tackle, score, respawn, and timer transitions in the scripted replay.

- [ ] **Step 6: Run focused and global checks**

Run: `npx vitest run src/server/game && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit the engine**

```bash
git add src/server/game
git commit -m "feat: add deterministic authoritative simulation"
```

### Task 3: Room, Session, and Reconnection Lifecycle

**Files:**
- Create: `src/server/rooms/domainError.ts`
- Create: `src/server/rooms/roomManager.ts`
- Test: `src/server/rooms/roomManager.test.ts`

**Interfaces:**
- Consumes: shared room/match types, `createMatchState`, `stepMatch`, `snapshotMatch`.
- Produces: `RoomManager`, `RoomPublication`, `DomainError`.

```ts
export type RoomPublication =
  | { type: 'ROOM_STATE'; roomCode: string; state: RoomState }
  | { type: 'MATCH_STARTED'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_SNAPSHOT'; roomCode: string; snapshot: MatchSnapshot }
  | { type: 'MATCH_EVENT'; roomCode: string; event: GameEvent }
  | { type: 'ROOM_CLOSED'; roomCode: string };

export class RoomManager {
  constructor(deps: { now: () => number; randomBytes: (size: number) => Uint8Array; publish: (event: RoomPublication) => void });
  createRoom(connectionId: string, name: string): SessionWelcome;
  joinRoom(connectionId: string, roomCode: string, name: string): SessionWelcome;
  resume(connectionId: string, roomCode: string, resumeToken: string): SessionWelcome;
  setTeam(connectionId: string, team: Team): void;
  setReady(connectionId: string, ready: boolean): void;
  startMatch(connectionId: string): void;
  applyInput(connectionId: string, input: InputFrame): void;
  setResultReady(connectionId: string, ready: boolean): void;
  returnToLobby(connectionId: string): void;
  disconnect(connectionId: string): void;
  advance(elapsedMs: number): void;
}
```

- [ ] **Step 1: Write lifecycle tests with a fake clock and deterministic bytes**

```ts
it('counts reconnect reservations toward capacity and restores identity', () => {
  const { manager, clock } = roomManagerFixture();
  const host = manager.createRoom('c-1', 'Ada');
  const joined = Array.from({ length: 7 }, (_, index) => manager.joinRoom(`c-${index + 2}`, host.roomCode, `P${index + 2}`));
  manager.disconnect('c-8');
  expect(() => manager.joinRoom('c-9', host.roomCode, 'Ninth')).toThrowErrorCode('ROOM_FULL');
  expect(manager.resume('c-10', host.roomCode, joined[6].resumeToken).playerId).toBe(joined[6].playerId);
  clock.advance(20_001);
  manager.advance(0);
  expect(manager.joinRoom('c-9', host.roomCode, 'Ninth').roomCode).toBe(host.roomCode);
});

it('migrates host permanently and keeps resumed former host as a member', () => {
  const { manager, roomState } = roomManagerFixture();
  const first = manager.createRoom('c-1', 'Ada');
  const second = manager.joinRoom('c-2', first.roomCode, 'Linus');
  manager.disconnect('c-1');
  expect(roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
  manager.resume('c-3', first.roomCode, first.resumeToken);
  expect(roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
});
```

Cover four-character collision retry, alternating balanced assignment, legal/illegal switches, start prerequisites, host-only start/lobby actions, join rejection during a match, disconnect core drop, under-populated pause/abort, room expiry, result ready/reset, and no stale connection mappings.

- [ ] **Step 2: Run tests and confirm red**

Run: `npx vitest run src/server/rooms`

Expected: FAIL because room modules do not exist.

- [ ] **Step 3: Implement typed failures and room state machine**

`DomainError` carries only `code`, Turkish `safeMessage`, and `recoverable`; no stack or internal state reaches clients. Use a `Map<string, Room>` and a reverse `Map<connectionId, { roomCode, playerId }>`.

Generate codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` using injected cryptographic bytes, retrying until absent. Generate a separate 32-byte hex resume token. Compare token byte values with `timingSafeEqual` only after equal-length validation. Reserved players remain in `room.players` with `connected=false`, count toward capacity, and are deleted by `advance` after the exact grace deadline.

- [ ] **Step 4: Integrate fixed-step room advancement**

Each active room owns `accumulatorMs` and `snapshotAccumulatorMs`. `advance(elapsedMs)` clamps elapsed to 250 ms, performs at most five `1000/30` simulation steps, publishes every returned game event, and publishes a full snapshot whenever the 20 Hz threshold passes. Discard excess backlog after the cap and keep the process alive.

- [ ] **Step 5: Run focused and global checks**

Run: `npx vitest run src/server/rooms src/server/game && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit room lifecycle**

```bash
git add src/server/rooms
git commit -m "feat: add room and reconnect lifecycle"
```

### Task 4: Socket Server and One-Command LAN Runtime

**Files:**
- Create: `src/server/network/createGameServer.ts`
- Create: `src/server/network/socketHandlers.ts`
- Create: `src/server/runtime/lanAddresses.ts`
- Create: `src/server/main.ts`
- Test: `src/server/runtime/lanAddresses.test.ts`
- Test: `tests/integration/socketFlow.test.ts`

**Interfaces:**
- Consumes: `RoomManager`, protocol schemas/event maps, `forceDelivery`.
- Produces: `createGameServer(options): GameServer`, `discoverLanUrls(port, interfaces)`, production executable.

```ts
export interface GameServer {
  start(): Promise<{ port: number; origin: string }>;
  stop(): Promise<void>;
  rooms: RoomManager;
  testHarness: {
    deliverCore(roomCode: string, team: Team): void;
    disconnectPlayer(roomCode: string, playerId: string): void;
    matchSnapshot(roomCode: string): MatchSnapshot | null;
  } | null;
}
```

- [ ] **Step 1: Write LAN address tests**

Supply fake interfaces and assert localhost, RFC1918 inclusion, public-address exclusion, and VPN labeling:

```ts
expect(discoverLanUrls(4173, {
  en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
  utun4: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
  en1: [{ address: '203.0.113.2', family: 'IPv4', internal: false }]
})).toEqual([
  { url: 'http://localhost:4173', kind: 'local' },
  { url: 'http://192.168.1.10:4173', kind: 'lan' },
  { url: 'http://10.8.0.2:4173', kind: 'virtual' }
]);
```

- [ ] **Step 2: Write two-client integration tests**

Start an ephemeral server on `127.0.0.1`, connect two `socket.io-client` instances with WebSocket transport, and wrap acknowledgements in a timeout helper. Prove:

```ts
const room = await emitAck(clientA, 'room:create', { name: 'Ada' });
await emitAck(clientB, 'room:join', { name: 'Linus', roomCode: room.roomCode });
await emitAck(clientA, 'lobby:ready', { ready: true });
await emitAck(clientB, 'lobby:ready', { ready: true });
await emitAck(clientA, 'match:start', {});
await expectEvent(clientB, 'match:started');
server.testHarness!.deliverCore(room.roomCode, 'CYAN');
await expectMatchEvent(clientB, 'SCORE');
```

Also assert malformed strict payload rejection, non-host start rejection, input sequence monotonicity, match join rejection, host migration, forced disconnect, resume with the same `playerId`, seven forced deliveries, result state, rematch readiness, and return to lobby. For rate limiting, burst 61 input events without advancing the limiter clock; require one `server:error` with code `RATE_LIMITED`, prove sequence 61 is absent from the next authoritative acknowledgement, and suppress additional rate-limit errors from that socket for one second.

- [ ] **Step 3: Run focused tests and confirm red**

Run: `npx vitest run src/server/runtime tests/integration/socketFlow.test.ts`

Expected: FAIL because server modules do not exist.

- [ ] **Step 4: Implement server composition and socket boundary**

Use `http.createServer(expressApp)` and attach one typed Socket.IO server. Register a shared helper per acknowledgement event that calls `schema.safeParse`, invokes the room method, returns `{ ok: true, data }`, and maps `DomainError` to `{ ok: false, error }`. Any unexpected error is logged server-side with a request correlation ID and returns `INTERNAL_ERROR` without details.

Maintain a token bucket per socket for room actions (10/second) and inputs (60/second). The first rejected action in a one-second window emits `server:error` with code `RATE_LIMITED`; rejected input is never stored, and repeated errors are suppressed until the window resets. Delete buckets on disconnect. Start one monotonic scheduler using `performance.now()` and pass elapsed time to all rooms; do not create one interval per player.

In production, serve `dist/client`, add a SPA fallback excluding `/socket.io` and `/health`, and return health JSON. The direct test harness is created only when `enableTestHarness: true`; it is not registered as HTTP or Socket.IO traffic.

- [ ] **Step 5: Implement startup and graceful shutdown**

Validate `PORT` as an integer from 1–65535, bind `HOST ?? '0.0.0.0'`, print the product banner and discovered URLs, then explain firewall troubleshooting in one line. On `SIGINT` or `SIGTERM`, await `server.stop()` once and set a nonzero exit code only on failure.

- [ ] **Step 6: Run integration, health, and build checks**

Run: `npx vitest run src/server tests/integration && npm run typecheck && npm run build`

Expected: PASS, with `dist/client/index.html` and `dist/server/main.js` present.

- [ ] **Step 7: Commit networking and runtime**

```bash
git add src/server tests/integration package.json package-lock.json
git commit -m "feat: host authoritative rooms over LAN"
```

### Task 5: Client Store, Landing, and Lobby

**Files:**
- Create: `src/client/network/GameClient.ts`
- Create: `src/client/state/gameStore.ts`
- Create: `src/client/state/useGameStore.ts`
- Create: `src/client/App.tsx`
- Create: `src/client/ui/LandingScreen.tsx`
- Create: `src/client/ui/LobbyScreen.tsx`
- Create: `src/client/ui/TopBar.tsx`
- Create: `src/client/ui/ToastRegion.tsx`
- Create: `src/client/styles/tokens.css`
- Create: `src/client/styles/layout.css`
- Test: `src/client/state/gameStore.test.ts`
- Test: `src/client/ui/LandingScreen.test.tsx`
- Test: `src/client/ui/LobbyScreen.test.tsx`
- Modify: `src/client/main.tsx`

**Interfaces:**
- Consumes: typed protocol, `RoomState`, `SessionWelcome`.
- Produces: `GameClient`, `gameStore`, `useGameStore`, landing/lobby React screens.

- [ ] **Step 1: Write store and screen tests**

```tsx
it('keeps entered values after a rejected join', async () => {
  const client = fakeClient({ join: failAck('ROOM_NOT_FOUND', 'Oda bulunamadı.') });
  render(<LandingScreen client={client} />);
  await user.type(screen.getByLabelText('Oyuncu adı'), 'Ada');
  await user.type(screen.getByLabelText('Oda kodu'), 'AB2Z');
  await user.click(screen.getByRole('button', { name: 'Odaya Katıl' }));
  expect(screen.getByLabelText('Oyuncu adı')).toHaveValue('Ada');
  expect(screen.getByLabelText('Oda kodu')).toHaveValue('AB2Z');
  expect(screen.getByText('Oda bulunamadı.')).toBeVisible();
});

it('shows two team columns and disables host start until everyone is ready', () => {
  renderLobby(roomFixture({ selfIsHost: true, players: [readyPlayer('Ada', false), readyPlayer('Linus', true)] }));
  expect(screen.getByRole('heading', { name: 'Camgöbeği Takım' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Kehribar Takım' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Maçı Başlat' })).toBeDisabled();
});
```

Also test pending-button state, trimmed/normalized values, copy-room-code feedback, team-switch failure, host crown, disconnected reservation label, visible focus classes, and non-host absence of start controls.

- [ ] **Step 2: Run client tests and confirm red**

Run: `npx vitest run src/client/state src/client/ui`

Expected: FAIL because client modules do not exist.

- [ ] **Step 3: Implement typed client and external store**

`GameClient` owns one same-origin `socket.io-client` instance, supplies promise-based acknowledgement methods, subscribes to all server events, and never imports React. Development uses the Vite WebSocket proxy defined in Task 1; production connects directly to the shared Express/Socket.IO origin. `gameStore` exposes:

```ts
export interface GameStore {
  getSnapshot(): ClientState;
  subscribe(listener: () => void): () => void;
  actions: {
    createRoom(name: string): Promise<void>;
    joinRoom(name: string, code: string): Promise<void>;
    setTeam(team: Team): Promise<void>;
    setReady(ready: boolean): Promise<void>;
    startMatch(): Promise<void>;
  };
}
```

Store resume tokens in `sessionStorage` under `neon-relay:${roomCode}:resume`; keep the latest room code separately for reconnect bootstrap. Server state replaces canonical slices; optimistic UI is limited to disabled/pending controls.

- [ ] **Step 4: Build the accessible shell and lobby**

Use semantic `main`, `form`, headings, lists, and buttons. Keep the primary action within the first viewport at 900×600. The CSS token layer defines the near-black surfaces, cyan/amber team colors, semantic colors, 4/8/12/16/24/32 spacing, two font stacks, radii, focus ring, and reduced-motion behavior. No gradients behind body text and no arbitrary decorative cards.

- [ ] **Step 5: Run component and static checks**

Run: `npx vitest run src/client && npm run typecheck && npm run lint && npm run build:client`

Expected: PASS.

- [ ] **Step 6: Commit landing and lobby**

```bash
git add src/client index.html
git commit -m "feat: add polished room and lobby flow"
```

### Task 6: Canvas Match, Input, Prediction, and HUD

**Files:**
- Create: `src/client/game/keyboard.ts`
- Create: `src/client/game/prediction.ts`
- Create: `src/client/game/renderer.ts`
- Create: `src/client/game/GameCanvas.tsx`
- Create: `src/client/styles/game.css`
- Test: `src/client/game/keyboard.test.ts`
- Test: `src/client/game/prediction.test.ts`
- Test: `src/client/game/renderer.test.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/state/gameStore.ts`

**Interfaces:**
- Consumes: snapshots/events, shared constants/geometry, `GameClient.sendInput`.
- Produces: `KeyboardController`, `PredictionBuffer`, `interpolateSnapshot`, `renderFrame`, `GameCanvas`.

- [ ] **Step 1: Write input and prediction tests**

```ts
it('emits one dash edge while space remains held', () => {
  const keyboard = new KeyboardController(fakeWindow());
  keyboard.keyDown('Space');
  expect(keyboard.sample(1).dash).toBe(true);
  expect(keyboard.sample(2).dash).toBe(false);
  keyboard.keyUp('Space');
  keyboard.keyDown('Space');
  expect(keyboard.sample(3).dash).toBe(true);
});

it('drops acknowledged input and replays remaining frames', () => {
  const buffer = new PredictionBuffer('p-1');
  buffer.push(input(1, { right: true }));
  buffer.push(input(2, { right: true }));
  const position = buffer.reconcile(authoritativePlayer({ x: 100, y: 100, lastProcessedInputSeq: 1 }), 1000 / 30);
  expect(position.x).toBeGreaterThan(100);
  expect(buffer.pendingSequences()).toEqual([2]);
});
```

Also test WASD/arrows equivalence, blur reset, default scrolling suppression only during a match, 100 ms interpolation, small correction blending, 140 px snap, device-pixel-ratio sizing, and letterbox coordinate transforms.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `npx vitest run src/client/game`

Expected: FAIL because game-client modules do not exist.

- [ ] **Step 3: Implement the browser game runtime**

`GameCanvas` starts exactly one `requestAnimationFrame`, one 30 Hz input sender, and one `ResizeObserver`; cleanup cancels all three and removes keyboard listeners. It keeps mutable frame data in refs so React does not rerender at frame rate. `PredictionBuffer` uses shared movement constants and public obstacle geometry but never predicts tackles, pickups, scores, or phase changes.

The renderer draws in this order: background/grid, reactors, barriers, core pads, free/carried cores, player shadows, players/dash trails, name labels, and authoritative event particles. It uses no DOM text for per-frame objects and does not allocate arrays inside the hot render path after initialization.

- [ ] **Step 4: Add the match HUD**

Render team scores, centered regulation/sudden-death clock, phase/countdown, local dash cooldown bar, carried-core indicator, ping, controls hint, and viewport-too-small warning. All critical score/time information exists outside Canvas as accessible text. Hide lobby actions during the match.

- [ ] **Step 5: Run focused and global checks**

Run: `npx vitest run src/client/game src/client/state && npm run typecheck && npm run lint && npm run build:client`

Expected: PASS.

- [ ] **Step 6: Commit gameplay client**

```bash
git add src/client/game src/client/styles/game.css src/client/App.tsx src/client/state
git commit -m "feat: render and control real-time matches"
```

### Task 7: Results, Recovery, Audio, and Interaction Polish

**Files:**
- Create: `src/client/game/audio.ts`
- Create: `src/client/ui/ConnectionOverlay.tsx`
- Create: `src/client/ui/ResultScreen.tsx`
- Test: `src/client/game/audio.test.ts`
- Test: `src/client/ui/ConnectionOverlay.test.tsx`
- Test: `src/client/ui/ResultScreen.test.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/state/gameStore.ts`
- Modify: `src/client/styles/layout.css`
- Modify: `src/client/styles/game.css`

**Interfaces:**
- Consumes: `GameEvent`, result `RoomState`, session reconnect deadlines.
- Produces: `AudioCues`, result/rematch screen, reconnect overlay, toast/event feedback.

- [ ] **Step 1: Write recovery, result, and audio tests**

```tsx
it('shows a reconnect deadline without destroying match content', () => {
  render(<App initialState={disconnectedMatchState({ reconnectRemainingMs: 12_400 })} />);
  expect(screen.getByRole('dialog', { name: 'Bağlantı kesildi' })).toHaveTextContent('13 saniye');
  expect(screen.getByTestId('game-canvas')).toBeInTheDocument();
});

it('lets every player ready again and exposes lobby return only to host', () => {
  render(<ResultScreen state={resultFixture({ selfIsHost: false })} />);
  expect(screen.getByRole('button', { name: 'Tekrar Hazır' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Lobiye Dön' })).toBeNull();
});
```

Test `AudioCues` with a fake `AudioContext`: no context before user gesture, distinct oscillator/envelope calls for pickup/tackle/score/countdown/win, persisted mute, and no playback while muted.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `npx vitest run src/client/game/audio.test.ts src/client/ui`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement reconnection and result actions**

On Socket.IO reconnect, the store reads the saved room/token and sends `session:resume` before allowing normal actions. A successful resume replaces room/match state and clears the overlay. An invalid/expired token returns to landing with a Turkish explanation and removes only that room's stale token.

Result statistics sort by team then deliveries descending then stable name. Rematch readiness uses server state only. Host `Lobiye Dön` requires a confirm-once dialog only when at least one player is rematch-ready.

- [ ] **Step 4: Implement generated audio and final interaction states**

Use oscillator plus gain ramps under 300 ms; do not fetch media. Unlock from the first pointer or keyboard gesture. Persist mute as `neon-relay:muted`. Honor `prefers-reduced-motion`, provide `aria-live` for connection/game events, and verify hover/active/disabled/focus-visible styles for every control.

- [ ] **Step 5: Run client verification**

Run: `npx vitest run src/client && npm run typecheck && npm run lint && npm run build:client`

Expected: PASS.

- [ ] **Step 6: Commit recovery and polish**

```bash
git add src/client
git commit -m "feat: add rematch recovery and game feedback"
```

### Task 8: Eight-Client Load Smoke and Full Integration Coverage

**Files:**
- Create: `tests/load/eightClients.test.ts`
- Modify: `tests/integration/socketFlow.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `createGameServer`, typed events and acknowledgements.
- Produces: repeatable eight-client stability evidence.

- [ ] **Step 1: Write the bounded load smoke**

Connect eight WebSocket-only clients, create/join one room, ready all players, start, then send deterministic held inputs at 30 Hz for ten seconds. Record snapshot counts and client errors.

```ts
expect(clients).toHaveLength(8);
expect(snapshotCounts.every((count) => count >= 150)).toBe(true);
expect(errors).toEqual([]);
expect(await fetch(`${origin}/health`).then((response) => response.status)).toBe(200);
expect(server.rooms.debugRoom(roomCode).connectedCount).toBe(8);
```

Disconnect all eight, stop the server, and assert Vitest has no open handles or unhandled rejections.

- [ ] **Step 2: Run the load smoke and confirm its first failure**

Run: `npx vitest run tests/load/eightClients.test.ts --testTimeout=30000`

Expected before fixture completion: FAIL at the first unmet load assertion, not from a hanging process.

- [ ] **Step 3: Add only the instrumentation needed by tests**

Expose immutable `debugRoom(roomCode)` data from `RoomManager` containing phase, connected/reserved counts, player IDs, tick, and scores. Do not expose tokens, mutable maps, or a production route. Fix listener cleanup, scheduler drift, or snapshot pacing found by the smoke; do not weaken count/time assertions.

- [ ] **Step 4: Run all server and load tests repeatedly**

Run: `npm test && for run in 1 2 3; do npx vitest run tests/load/eightClients.test.ts --testTimeout=30000 || exit 1; done`

Expected: all four runs PASS, health remains responsive, and processes exit cleanly.

- [ ] **Step 5: Commit load coverage**

```bash
git add tests/load tests/integration vitest.config.ts src/server
git commit -m "test: verify eight-player LAN stability"
```

### Task 9: Browser Acceptance, Documentation, and Release Verification

**Files:**
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/neon-relay.spec.ts`
- Create: `README.md`
- Modify: `playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: built production client/server and direct `GameServer.testHarness`.
- Produces: end-to-end proof, screenshots, and exact host/join documentation.

- [ ] **Step 1: Write the two-context Playwright flow**

Start `createGameServer({ host: '127.0.0.1', port: 0, staticDir: 'dist/client', enableTestHarness: true })` in a worker-scoped fixture and set Playwright to one worker. The test must:

```ts
await hostPage.getByLabel('Oyuncu adı').fill('Ada');
await hostPage.getByRole('button', { name: 'Oda Kur' }).click();
const roomCode = await hostPage.getByTestId('room-code').textContent();
await guestPage.getByLabel('Oyuncu adı').fill('Linus');
await guestPage.getByLabel('Oda kodu').fill(roomCode!);
await guestPage.getByRole('button', { name: 'Odaya Katıl' }).click();
await Promise.all([
  hostPage.getByRole('button', { name: 'Hazırım' }).click(),
  guestPage.getByRole('button', { name: 'Hazırım' }).click()
]);
await hostPage.getByRole('button', { name: 'Maçı Başlat' }).click();
await expect(hostPage.getByTestId('game-canvas')).toBeVisible();
```

Read the host player's initial x-coordinate from `testHarness.matchSnapshot(roomCode)`, hold `KeyD`, and poll the same direct test fixture until the canonical x-coordinate increases; then verify the guest context continues receiving snapshots. This proves real browser input without adding debug coordinates to the production DOM. Force seven deliveries through the direct test fixture, assert the result score/winner, ready both players, and start a rematch.

- [ ] **Step 2: Add reconnect and viewport coverage**

During a second match, call `testHarness.disconnectPlayer`, assert the connection overlay appears over the retained Canvas, wait for automatic resume, and assert the same player name/ID remains. Capture full-page screenshots for landing, lobby, match, reconnect, and result at 1440×900, 1280×720, 1024×768, and 900×600. Fail on page errors, console errors, horizontal document overflow, clipped primary actions, or zero-size Canvas.

- [ ] **Step 3: Run E2E and resolve real product failures**

Run: `npm run test:e2e`

Expected: PASS in Chromium with artifacts only on failure; all browser contexts and server handles close.

- [ ] **Step 4: Write exact README instructions**

Document:

```bash
git clone https://github.com/reitenji/neon-relay.git
cd neon-relay
npm install
npm run lan
```

Explain that friends open a printed `http://192.168.x.x:4173` address, all devices must share a LAN, guest/client machines need only a modern desktop browser, and host firewalls must allow Node/port 4173. Include controls, room flow, Node 20 requirement, changing `PORT`, troubleshooting localhost-vs-peer access, development commands, and `npm run verify && npm run test:e2e`.

- [ ] **Step 5: Run the complete clean verification matrix**

Run:

```bash
npm ci
npm run verify
npm run test:e2e
PORT=4173 npm start
```

While the final server runs, probe `http://127.0.0.1:4173/health` and one printed non-loopback RFC1918 URL. Open two browser contexts and complete create/join/start/move/score/result/rematch once more. Stop with `SIGINT` and confirm clean exit.

- [ ] **Step 6: Inspect screenshots and current git state**

Visually inspect every required viewport screenshot for clipping, overlap, accidental wrapping, unreadable labels, missing states, and inconsistent controls. Run `git diff --check`, `git status --short`, `git log --oneline`, and confirm `origin` is `git@github.com:reitenji/neon-relay.git`.

- [ ] **Step 7: Commit docs and acceptance tests**

```bash
git add README.md .gitignore tests/e2e playwright.config.ts
git commit -m "docs: add LAN setup and browser acceptance"
```

- [ ] **Step 8: Independent review, fix loop, and GitHub publication**

Request independent spec-compliance and code-quality reviews. Apply accepted fixes with focused regression tests, rerun `npm run verify`, `npm run test:e2e`, and the real LAN health probes, then push only after `git status --short` is empty:

```bash
git push -u origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: both revisions are identical and `https://github.com/reitenji/neon-relay` contains the verified source and README.
