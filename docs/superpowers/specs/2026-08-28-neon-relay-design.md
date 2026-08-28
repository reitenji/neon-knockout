# Neon Relay — LAN Multiplayer Game Design

**Date:** 2026-08-28  
**Status:** Approved direction  
**Audience:** Implementation agents and reviewers

## 1. Product Summary

Neon Relay is a fast, team-based arena game for 2–8 friends on the same local network. One player hosts a Node.js process; everyone else joins from a desktop or laptop browser using the printed LAN URL. No client installation, account, cloud service, database, or internet connection is required after dependencies have been installed on the host.

Two teams compete to collect neutral energy cores from the center of a symmetric arena and carry them into their own reactor. A carrier moves more slowly and can be tackled with a dash, causing the core to drop. The first team to reach the score target wins, or the higher score wins when time expires. A tie enters sudden death, where the next delivery wins.

The product language is Turkish. The visual identity is a dark, restrained sci-fi arena with cyan and amber team colors, bright energy cores, clear silhouettes, and short synthesized sound effects.

## 2. Scope and Constraints

### Included

- Desktop and laptop browsers with keyboard input.
- 2–8 players per room.
- Multiple independent rooms in one server process, addressed by four-character room codes.
- Create-room, join-room, team selection, ready state, start, match, result, and rematch flows.
- Server-authoritative movement, collision, pickup, tackle, scoring, timer, and match transitions.
- Client-side prediction for the local player and interpolation for remote players.
- Reconnection to the same player slot during a 20-second grace period.
- Automatic host migration in the lobby and result screen.
- One-command production-style LAN startup after dependency installation.
- Health endpoint, local IP discovery, clear connection diagnostics, and graceful shutdown.
- Automated unit, integration, load-smoke, and browser end-to-end tests.
- Responsive desktop layout down to 900×600 CSS pixels.
- Keyboard accessibility and visible focus for all non-game controls.

### Explicitly excluded

- Mobile or touch controls.
- Bots, single-player mode, spectators, chat, voice, accounts, progression, persistence, matchmaking, or WAN/NAT traversal.
- Projectiles, weapons, damage, player death, respawning, inventory, or physics-engine dependencies.
- User-supplied assets or copyrighted media.
- Backward-compatibility layers; this is a new product.

## 3. Core Game Rules

### Match format

- Teams: `CYAN` and `AMBER`.
- Arena: fixed 1280×720 logical coordinate space, rendered responsively with letterboxing when needed.
- Match duration: 180 seconds.
- Score target: 7 delivered cores.
- Countdown: 3 seconds; player movement is locked until it completes.
- Regulation winner: first team to 7, otherwise the higher score at 0:00.
- Sudden death: when regulation ends tied, the timer displays `ALTIN ÇEKİRDEK`; existing cores are cleared, one golden core spawns at center, and its first delivery ends the match.
- Results screen: winning team, final score, per-player deliveries and successful tackles, `Tekrar Hazır` controls, and a host-only `Lobiye Dön` control.

### Player movement

- Input: `WASD` or arrow keys for movement; `Space` for dash.
- Base movement speed: 250 logical pixels per second.
- Carrier speed multiplier: 0.82.
- Player collision radius: 20 pixels.
- Players cannot leave the arena or pass through solid obstacles.
- All player pairs use the same circular collision rule. After movement, overlapping pairs are processed by ascending `(lowerPlayerId, higherPlayerId)` and each player is moved half the overlap distance along the center line. If centers are identical, the lower player ID resolves toward negative x and the higher toward positive x. Each correction is clipped against obstacles and arena bounds, and the pair pass repeats at most twice per tick.
- The server consumes the latest valid input per player on each fixed simulation step.

### Dash and tackle

- Dash speed multiplier: 2.35.
- Dash duration: 160 milliseconds.
- Dash cooldown: 1.8 seconds, starting when the dash begins.
- A dash starts only on the rising edge of the dash button and only when cooldown is zero.
- When a dashing opponent contacts a core carrier, the carrier drops the core, is pushed up to 52 pixels away from the tackler, and is movement-locked for 280 milliseconds. Push movement is resolved in one-pixel increments against arena bounds and solid obstacles; it stops at the last valid position and never pushes other players.
- A tackle may affect the same target only once per dash.
- The player who dropped a core cannot pick that same core up for 650 milliseconds.
- A successful tackle increments the tackler's statistic and triggers one authoritative game event.

### Cores and scoring

- Three neutral spawn pads sit across the arena center line. One pad is active with 2–3 connected players, two with 4–5, and all three with 6–8; active-pad count is fixed when a match starts.
- At most one core belongs to each pad. If its core is carried or loose, that pad does not spawn another.
- A missing pad core respawns 2.5 seconds after delivery.
- A free core is picked up when an eligible player overlaps it.
- A player may carry only one core. The core follows the carrier and is not independently collidable while carried.
- Entering the carrier's own reactor scores one point, credits one delivery, clears the carried core, and schedules its pad respawn.
- Carrying a core into the opposing reactor has no effect.
- A loose core that remains untouched for 8 seconds returns to its spawn pad.
- In sudden death, the golden core has no pad respawn and any valid delivery ends the match.

### Deterministic simulation order

- Every tick processes phases in this order: normalize latest inputs, start dashes, move players, resolve obstacle/boundary collisions, resolve player separation, resolve tackles, update dropped-core locks, resolve pickups, resolve reactor deliveries, advance timers/respawns, then evaluate match transitions.
- Within a phase, players are processed by ascending stable `playerId`; cores are processed by ascending stable `coreId`.
- If multiple eligible players overlap one core on the same tick, the player with the smallest squared distance to its center wins; equal distances are broken by ascending `playerId`.
- A core dropped by a tackle cannot be picked up or delivered during that same tick. A delivery wins over an expiring match timer because deliveries are processed before match transitions.

### Arena layout

- The arena is horizontally symmetric.
- Cyan reactor and spawn area are on the left; amber reactor and spawn area are on the right.
- Three core pads are centered vertically at y=220, y=360, and y=500.
- Four rectangular barriers create top and bottom routes without blocking any spawn-to-reactor path.
- Reactors are visually distinct scoring zones, not solid obstacles.
- Collision geometry is defined in shared constants and rendered from the same data used by the server.

## 4. Lobby, Sessions, and Room Lifecycle

### Landing screen

- A player enters a display name of 2–16 visible characters.
- The name is trimmed, Unicode-normalized, stripped of control characters, and escaped by React when rendered.
- `Oda Kur` creates a room and stores the returned room code and resume token locally.
- `Odaya Katıl` accepts a case-insensitive four-character room code that omits ambiguous characters (`0`, `O`, `1`, `I`).
- Action errors are shown beside the relevant control and never erase entered values.

### Lobby

- New players join the team with fewer members; ties alternate deterministically.
- A team switch is allowed only if the resulting team-size difference is at most one.
- Every player controls their own `Hazırım` state.
- The host can start when there are at least two connected players, both teams are non-empty, and every connected player is ready.
- Joining a room is rejected while its match or countdown is active, except for a valid reconnect.
- The oldest connected player becomes host immediately if the host disconnects.
- Host migration is permanent until another host disconnect occurs; a former host who resumes returns as a normal player and does not reclaim host controls automatically.
- Empty rooms are deleted after the last reconnect grace period expires.

### Disconnection and reconnection

- `socket.id` is never treated as a player identity.
- Each joined player receives a random public `playerId` and secret 256-bit `resumeToken`.
- The browser stores the token in `sessionStorage`, scoped by server origin and room code.
- On disconnect, the player's avatar is removed from active simulation immediately and any carried core is dropped.
- The slot, team, statistics, and identity remain reserved for 20 seconds.
- Connected and reconnect-reserved slots both count toward the eight-player room capacity. Reserved players do not count toward ready/start checks or active team balance, but their team assignment remains held until expiry.
- A valid resume token reattaches a new socket to the same player and returns the latest canonical room or match snapshot.
- Expired or invalid tokens cannot claim a slot and return a typed error.
- If fewer than two players remain connected during a match, the simulation pauses for up to the remaining grace period and shows `Oyuncu yeniden bağlanıyor`.
- If the room does not return to at least two connected players before the grace period ends, the match ends and returns to the lobby without declaring a winner.

### Rematch

- On the results screen, every connected player toggles `Tekrar Hazır`.
- When all connected players are ready and both teams remain populated, the host can start another match.
- Match statistics reset; room membership and teams remain.
- `Lobiye Dön` resets ready states and returns everyone to the lobby without changing teams.

## 5. Network and Simulation Architecture

### Runtime shape

- One Node.js process owns Express, Socket.IO, all rooms, and all simulations.
- Vite builds the React client to `dist/client`; the Node server is bundled to `dist/server/main.js`.
- Production startup serves the built client and Socket.IO from the same HTTP origin.
- The server binds to `0.0.0.0` by default and accepts a validated `PORT` environment variable, default `4173`.
- `GET /health` returns HTTP 200 with `{ "status": "ok", "rooms": number, "uptimeSeconds": number }`.
- Startup discovery enumerates active, non-internal IPv4 interfaces and prints only RFC1918 addresses (`10/8`, `172.16/12`, `192.168/16`) plus localhost. Interface names commonly associated with virtual/VPN adapters are labeled `olası sanal/VPN arayüzü` rather than silently removed. The startup text also says that a host firewall may need to allow the selected port when localhost works but peers cannot connect.

### Authoritative loop

- Simulation runs at a fixed 30 Hz using accumulated monotonic elapsed time with a maximum catch-up limit of five steps.
- State snapshots broadcast at 20 Hz.
- Each input message contains an increasing sequence number and held-button state; positions and timestamps supplied by the client are ignored.
- Input is schema-validated, clamped to legal buttons, rate-limited to 60 messages per second per socket, and stored as the latest input.
- Snapshots include the server tick and each player's last processed input sequence.
- The game simulation is deterministic for a given initial state and ordered input sequence.

### Client smoothing

- The local player is predicted using the same movement constants and input semantics as the server.
- On a canonical snapshot, acknowledged inputs are removed and unacknowledged inputs are replayed from the authoritative local position.
- Remote players and free cores render 100 milliseconds behind the latest server timestamp using linear interpolation.
- Large corrections snap when the error exceeds 140 pixels; smaller corrections blend over 100 milliseconds.
- Scoring, tackles, countdown, sudden death, and match-end presentation only react to server messages.

### Typed protocol

Client-to-server events:

- `room:create` — `{ name }` with acknowledgement.
- `room:join` — `{ name, roomCode }` with acknowledgement.
- `session:resume` — `{ roomCode, resumeToken }` with acknowledgement.
- `lobby:team` — `{ team }`.
- `lobby:ready` — `{ ready }`.
- `match:start` — empty payload, host-only.
- `match:input` — `{ seq, up, down, left, right, dash }`.
- `result:ready` — `{ ready }`.
- `result:lobby` — empty payload, host-only.

Server-to-client events:

- `session:welcome` — identity, room code, resume token, and resumed flag.
- `room:state` — canonical lobby or result state.
- `match:started` — initial full match snapshot.
- `match:snapshot` — canonical snapshot and acknowledgements.
- `match:event` — typed pickup, drop, tackle, score, phase, and result events.
- `server:error` — `{ code, message, recoverable }`.

Acknowledgements return a discriminated union: `{ ok: true, data }` or `{ ok: false, error }`. Zod schemas validate all external payloads at the socket boundary.

## 6. Code Boundaries

The project uses one npm package to minimize installation and coordination overhead.

- `src/shared/` — protocol schemas/types, game constants, arena geometry, and pure model types.
- `src/server/game/` — deterministic state creation and fixed-step simulation; no Socket.IO imports.
- `src/server/rooms/` — room membership, session reservation, host migration, and lifecycle transitions.
- `src/server/network/` — Socket.IO wiring, validation, acknowledgements, and broadcast mapping; no game-rule calculations.
- `src/server/main.ts` — HTTP server composition, static serving, LAN address output, signals, and health endpoint.
- `src/client/network/` — typed socket wrapper, connection state, resume handshake, and snapshot buffer.
- `src/client/game/` — keyboard input, prediction/interpolation, Canvas renderer, Web Audio cues, and game loop.
- `src/client/ui/` — React landing, lobby, HUD, connection overlay, and result screens.
- `tests/` — server game-unit tests, room/network integration tests, load smoke test, and Playwright flows.

Dependencies are limited to React, Express, Socket.IO, Zod, and small build/test utilities. No game engine, state-management library, CSS framework, database, or external asset pipeline is required.

## 7. User Experience and Visual Direction

### Common shell

- Full-viewport near-black background with a restrained grid/noise texture made in CSS.
- A compact top bar displays the Neon Relay mark, room code, connection quality, sound toggle, and control reminder.
- Cyan and amber are reserved for teams; green, yellow, and red are reserved for semantic status.
- System text uses a legible UI sans-serif stack; scores and timers use a tabular monospace stack.
- Controls have visible hover, active, disabled, and `:focus-visible` states.

### Lobby

- Two clearly separated team columns show colored player markers, name, host crown, connection state, and ready status.
- Primary next action is always obvious: ready toggle for players, start button for the host.
- The room code includes a copy button and explanatory text for LAN friends.

### Match

- Canvas preserves the arena aspect ratio and never clips game content.
- HUD shows team scores, large centered clock/phase, dash cooldown, carried-core state, latency, and a compact controls hint.
- Name labels remain readable without obscuring action.
- Important game events use brief, non-blocking text and screen feedback.
- Web Audio produces short pickup, tackle, score, countdown, and win cues after the first user gesture; sound can be muted and the preference persists.

### Error and recovery states

- Connection loss overlays the game without destroying the last frame.
- Reconnect countdown communicates how long the reserved slot remains.
- Server-unavailable, room-not-found, room-full, match-in-progress, invalid-name, unbalanced-team, not-ready, and host-only failures have distinct Turkish messages.
- A viewport smaller than 900×600 receives a clear size warning instead of a broken arena.

## 8. Security and Robustness

- Socket payloads are runtime-validated before state access.
- Unknown fields are stripped or rejected consistently.
- Player names never enter `innerHTML` or Canvas without length normalization.
- Room codes use cryptographically secure random bytes and collision retry.
- Resume tokens use cryptographically secure random bytes and timing-safe comparison where applicable.
- Socket input, room action, and connection attempts have bounded per-socket rates.
- A single slow or malformed client cannot stop a room loop.
- The fixed-step loop caps catch-up work to prevent a process stall spiral.
- Process signals stop room loops and close HTTP/Socket.IO cleanly.

## 9. Verification and Acceptance Gates

### Automated

1. Unit tests prove normalization, vector movement, arena/obstacle collision, dash edges/cooldown, tackle eligibility, core pickup/drop/return, scoring, target-score win, timed win, sudden death, and deterministic replay.
2. Room tests prove code generation, capacity, balanced assignment, legal team switches, ready/start rules, host migration, reconnect reservation/expiry, room deletion, rematch, and aborted under-populated match.
3. Socket integration tests run an ephemeral server and prove create/join/start/input/snapshot/score/result/rematch, malformed-payload rejection, unauthorized host actions, and token-based resume with two real Socket.IO clients.
4. An eight-client smoke test joins one room, marks everyone ready, starts a match, sends bounded input for at least five seconds, and proves snapshots continue, no client errors occur, and the server remains healthy.
5. Playwright runs two isolated browser contexts through create, join, ready, start, visible movement, results, and rematch. Tests use an in-process `GameServer` fixture whose public test harness calls the same server-side `deliverCore(roomCode, team)` domain command as simulation; the harness is injected directly by tests and exposes no HTTP or Socket.IO event in production.
6. Build, TypeScript checks, lint checks, and all tests pass from a clean dependency installation.

### Runtime and visual

1. `npm run lan` builds and starts the production server in one command.
2. Startup output prints `localhost` and every usable private IPv4 LAN URL.
3. `/health` returns HTTP 200 from localhost and one discovered non-loopback address.
4. Two real browser sessions complete a full gameplay flow, including one forced socket disconnect/resume during a match, without console errors.
5. Lobby, match, reconnect overlay, and result screen are visually inspected at 1440×900, 1280×720, 1024×768, and the supported minimum 900×600.
6. Keyboard focus order, button disabled states, arrow/WASD input suppression, and sound mute are verified.
7. README host/join instructions work verbatim on macOS and remain platform-neutral for Windows/Linux hosts with Node.js 20 or newer.

## 10. Delivery Definition

The game is complete only when the source, automated tests, production build, two-browser flow, eight-client smoke test, real LAN-bound health probe, responsive visual checks, and README instructions all pass against the current worktree. Passing isolated unit tests alone is insufficient.
