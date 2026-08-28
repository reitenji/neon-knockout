# Neon Knockout — Combat-First LAN Game Redesign

**Date:** 2026-08-28
**Status:** Approved design and implementation contract
**Supersedes:** `2026-08-28-neon-relay-design.md`
**Audience:** Implementation agents, reviewers, and acceptance testers

## 1. Decision and Product Promise

Neon Knockout replaces Neon Relay's rejected core-carrying game with a fast, combat-first arena brawler for 2–8 friends on the same local network. The old loop—collecting a core and returning it to one's own reactor—is removed, not retained as a mode or compatibility path.

One player runs the existing Node.js host. Every player, including the host, joins from a desktop or laptop browser. Guests install nothing. The host sees both localhost and LAN URLs, and the full product remains usable without accounts, cloud services, a database, or internet access after dependencies have been installed.

The game must deliver three feelings within the first ten seconds of a match:

1. **Immediate control:** movement, facing, attacks, and dash react as soon as the local player acts.
2. **Readable impact:** a successful hit is unmistakable through displacement, pose, hit flash, sparks, camera response, and sound.
3. **Constant contest:** the rules and shrinking arena force players into meaningful encounters instead of fetch routes or passive hiding.

The product language remains Turkish. The public repository may retain the `neon-relay` URL for continuity, while the game, package metadata, UI, and documentation use the product name **Neon Knockout**.

## 2. Scope

### Included

- Desktop and laptop browsers; keyboard plus mouse controls.
- 2–8 players in a free-for-all match.
- Multiple independent four-character LAN rooms in one server process.
- Create, join, chassis selection, ready, start, match, result, and rematch flows.
- Server-authoritative movement, attacks, hit detection, knockback, overload, ring-outs, scoring, respawns, arena contraction, timer, and match transitions.
- Phaser 4.2.1 for the arena scene, sprite animation, tweens, camera effects, particles, input integration, asset loading, and sound playback.
- Client prediction for local movement and attack presentation; interpolation for remote players.
- Four authored fighter chassis with equal gameplay properties and clearly different silhouettes.
- Reconnection to the same player and score during a 20-second grace period.
- Automatic host migration in the lobby and result phase; a host lost during a match is replaced immediately so result actions remain available.
- One-command production-style LAN startup, health endpoint, LAN address discovery, and clear connection diagnostics.
- Unit, integration, deterministic replay, eight-client load-smoke, and real-browser end-to-end verification.
- Responsive desktop presentation down to 900×600 CSS pixels.
- Keyboard accessibility and visible focus for all non-game controls.

### Explicitly excluded

- The old core, reactor, delivery, team, or goal-scoring rules.
- Mobile or touch controls.
- Bots, single-player mode, spectators, chat, voice, accounts, progression, persistence, matchmaking, or WAN/NAT traversal.
- Multiple arenas, ranked modes, unlocks, character-specific statistics, loot, random power-ups, or paid/copyrighted assets.
- Client-authoritative hit detection or score calculation.
- Backward-compatibility adapters for old snapshots, room state, test harnesses, or protocol events.

## 3. Match Loop

### Format and victory

- Mode: free-for-all arena brawl.
- Players: 2–8 connected players.
- Countdown: 3 seconds with movement and attacks locked.
- Regulation: 120 seconds.
- Score target: the first player to earn 5 knockouts wins immediately.
- At 0:00, a single highest-scoring player wins.
- If the top score is tied, the game enters `SUDDEN_DEATH`; the arena remains at minimum size and play continues until a scoring event produces one unique highest score.
- Results show the winner, final scores, knockouts, falls, landed hits, and attack accuracy. Accuracy is the percentage of completed attack instances that hit at least one target, so it never exceeds 100%.

### Scoring and ring-outs

- A player is knocked out when their center crosses the outer knockout boundary surrounding the visible platform.
- The last opponent to land a hit within the previous 4 seconds receives the knockout point.
- Leaving the arena without a recent opposing hit counts as a self-fall and awards no point.
- A knockout transition lasts 700 milliseconds from boundary crossing to restored control. It combines a fast exit burst and a warp-in rather than leaving the player watching an empty screen.
- Respawn resets overload but never subtracts score, lengthens later respawns, or applies an additional gameplay penalty.
- Respawn location is chosen deterministically from fixed spawn anchors by maximizing distance to active opponents; stable anchor order breaks ties.
- A respawned player has 650 milliseconds of visible protection and may move and attack immediately. Starting an attack cancels the remaining protection, so the shield cannot be used offensively without risk.

### Arena pressure

- The logical world remains 1280×720.
- The visible fighting platform is a centered, horizontally symmetric octagon with a surrounding void. Its regulation vertices are `(230,90)`, `(1050,90)`, `(1140,180)`, `(1140,540)`, `(1050,630)`, `(230,630)`, `(140,540)`, and `(140,180)` in clockwise order.
- The minimum platform vertices are `(330,150)`, `(950,150)`, `(1020,220)`, `(1020,500)`, `(950,570)`, `(330,570)`, `(260,500)`, and `(260,220)`. Contraction linearly interpolates corresponding vertices.
- A player is knocked out when outside the current platform and their shortest Euclidean distance to its polygon exceeds 80 logical pixels. This gives displaced players a short recovery window instead of causing an instant fall at the lip.
- With 30 seconds remaining, the platform enters a 3-second warning state, then contracts linearly for 17 seconds to its minimum dimensions and remains there.
- Contraction changes authoritative platform and knockout geometry on the server. The client renders the same shared geometry and warning progress.
- The first release contains no random hazards or pickups. Combat, positioning, recovery, and arena pressure determine the outcome.

## 4. Controls and Combat Rules

### Input

- `WASD` or arrow keys: movement.
- Mouse position: facing and attack direction in arena coordinates.
- Left mouse button: quick strike / three-hit combo.
- Right mouse button: hold to charge, release to perform a heavy strike. The browser context menu is suppressed only inside the arena.
- `Space`: directional dash using movement input; when there is no movement input, dash follows facing.
- Window blur, tab visibility loss, scene shutdown, and connection loss release all held inputs.

Each input frame contains an increasing sequence number, normalized movement axes, a finite normalized aim vector, held action buttons, and rising/falling edges derived by the server. Client positions, velocities, attack results, and timestamps are never trusted.

Movement vectors with magnitude above one are normalized. A nonzero aim vector is normalized; a zero or near-zero aim vector retains the player's last valid facing, defaulting to `(1,0)` at initial spawn.

### Movement model

- The server runs a velocity-based fixed-step movement model rather than directly adding a fixed displacement.
- Ground movement accelerates toward a maximum speed and uses drag when input is released.
- Knockback is an impulse added to velocity and is not erased by ordinary movement input.
- Outside the platform, steering strength drops to 45% and a 360 px/s² outward void pull follows the nearest platform-edge normal. This permits a short dash recovery without allowing a player to hover indefinitely beyond the lip.
- Players use the same circular body radius and equal movement values regardless of chassis.
- Player bodies separate predictably, but ordinary contact alone does not create a hit or score.

Initial tuning values are part of the implementation contract and may be changed only together with tests and recorded playtest evidence:

| Property | Initial value |
| --- | ---: |
| Player collision radius | 24 px |
| Maximum ground speed | 330 px/s |
| Ground acceleration | 2,400 px/s² |
| Dash speed | 760 px/s |
| Dash duration | 140 ms |
| Dash invulnerability | first 100 ms |
| Dash cooldown | 1,100 ms |
| Maximum overload | 150 |
| Knockout-to-control time | 700 ms |
| Respawn protection | 650 ms, cancelled by attacking |

### Quick combo

- A left-button rising edge starts a quick strike if the player is allowed to act.
- A buffered press during the final 120 milliseconds of recovery advances a maximum three-hit combo.
- The first two strikes are fast, short-range setup hits. The third has longer recovery and visibly stronger knockback.
- Each strike owns a forward arc, active interval, recovery interval, overload gain, and base impulse.
- One attack instance can hit each target only once. Hit candidates are ordered by distance and stable player ID so results are deterministic.
- Missing a strike still commits its recovery; repeated clicking cannot bypass timing.

Initial quick-strike tuning:

| Step | Range | Arc | Overload | Base impulse | Windup / active / recovery |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 72 px | 92° | 8 | 280 px/s | 70 / 60 / 100 ms |
| 2 | 76 px | 96° | 10 | 325 px/s | 65 / 65 / 120 ms |
| 3 | 88 px | 105° | 16 | 455 px/s | 115 / 70 / 205 ms |

### Charged heavy strike

- Holding the right button enters charge after 180 milliseconds; charge caps at 700 milliseconds.
- Movement speed is multiplied by 0.55 while charging.
- Releasing performs a forward heavy arc. Charge progress scales its overload gain, impulse, anticipation pose, sound pitch, and effect intensity.
- A fully charged strike is powerful but remains avoidable because charge direction is visible. Release consists of 110 milliseconds windup, 90 milliseconds active time, and 320 milliseconds recovery.
- Dash cancels an uncommitted charge but cannot cancel the heavy strike after release.
- Attacks cannot begin during dash, hitstun, or another attack's committed windup/active/recovery. Beginning an attack removes respawn protection before hit resolution. Dash cannot cancel a committed quick or heavy attack.

Initial heavy tuning ranges from 18–32 overload and 460–760 px/s base impulse over a 94-pixel, 82-degree arc.

### Knockback, hitstun, and overload

- A landed attack increases the target's overload, then applies impulse in the attack direction.
- Effective impulse uses the target's resulting overload: `baseImpulse × (1 + min(overload, 150) / 150 × 0.9)`.
- Hitstun scales from 90 to 230 milliseconds according to effective impulse.
- Overload does not decay during a life and resets only on respawn.
- A target may be hit again after hitstun; attack-instance target tracking prevents a single swing from hitting on multiple simulation ticks.
- Dash invulnerability rejects both the hit and all hit feedback. The attacker still completes recovery.
- Authoritative events identify attacker, target, attack kind, world impact position, impulse, resulting overload, and server tick.

### Combat state and ordering

Players expose explicit state needed for rules and presentation: position, velocity, facing, overload, combo step, attack phase/timers, charge duration, dash/cooldown, hitstun, respawn/invulnerability, last attacker, and statistics.

Every 60 Hz server step processes phases in this order:

1. Validate and normalize latest inputs.
2. Advance countdown, match, respawn, cooldown, and attack timers.
3. Update arena-contraction geometry for the current authoritative remaining time.
4. Start or buffer legal actions from button edges.
5. Apply ground acceleration, dash velocity, knockback velocity, drag, and movement.
6. Resolve player separation.
7. Resolve active attack arcs and emit hit events.
8. Test knockout boundaries, credit falls/knockouts, and schedule respawns.
9. Evaluate score target, time expiry, sudden death, and result transitions.

Within each phase, stable player IDs and attack IDs define deterministic ordering. A player knocked out during a step cannot hit or score later in that same step.

## 5. Fighter Identity and Animation

### Chassis roster

Players select one of four cosmetic chassis in the lobby. Duplicates are allowed. All chassis share exactly the same collision body, speed, attack timing, reach, overload, and knockback values.

- **RIFT:** blade-forward duelist silhouette with a narrow waist and split forearms.
- **BASTION:** broad shoulder plates and a shield-like chest silhouette.
- **PULSE:** triangular jet fins and a compact forward-leaning shape.
- **WRAITH:** crescent outer plates and a hollow luminous center.

The designs are original neon mech-gladiators, not circles with rectangular vanes. Team colors are no longer used; each player receives one of eight high-contrast accent colors and always retains their name label. The local player has an additional white under-ring that is never reused for opponents.

Accent slots are assigned deterministically from the lowest unused palette index and remain reserved during reconnect grace. Chassis defaults cycle by join order across `RIFT`, `BASTION`, `PULSE`, and `WRAITH`; a player may choose any chassis before readying.

### Asset and animation contract

- Final fighter art uses transparent texture atlases or layered transparent textures loaded by Phaser.
- No baked checkerboard, opaque background, stock watermark, copyrighted character, or placeholder geometric body may ship.
- Each chassis supports authored states for `idle`, `move`, combo strikes `1–3`, `heavy-charge`, `heavy-release`, `dash`, `hit`, `knockout`, and `respawn`.
- Animation may combine atlas frames with Phaser transforms and tweens, but attack anticipation, contact, and recovery must remain visually distinct.
- Idle and locomotion use continuous loops with pose variation; every attack, dash, hit, knockout, and respawn uses authored pose changes rather than a static sprite plus a trail.
- Local movement and attack anticipation begin on the next rendered frame after input. Idle/move transitions blend within 80 milliseconds, combo poses continue without snapping to idle between steps, and authoritative corrections do not restart an animation that is already in the correct state.
- Animation time is driven by elapsed milliseconds rather than rendered-frame counts, so motion speed stays stable on 60 Hz, 90 Hz, 120 Hz, and temporarily slower displays.
- Snapshot interpolation moves the fighter container while animation plays independently inside it. Network updates therefore cannot replace an authored pose with a visibly rigid slide.
- Direction follows the authoritative/predicted facing vector. Effects may rotate freely; chassis art must remain readable at all directions and supported viewport sizes.
- Reduced-motion mode removes nonessential camera shake and looping bob, shortens trails, and preserves attack/hit state readability.

### Impact feedback stack

Authoritative `HIT`, `KNOCKOUT`, and `RESPAWN` events drive presentation. A hit uses all of the following at proportional intensity:

- immediate local attack pose and directional weapon/energy arc;
- target hit pose, outline flash, and brief sprite-only impact hold;
- directional spark and shard particles;
- short camera nudge or low-amplitude shake;
- layered attack/contact sound with small deterministic pitch variation;
- overload number pulse and knockback trail.

A knockout adds a larger burst, edge streak, camera response, announcer text, and score pulse. Presentation effects never pause or alter the authoritative server clock. The client may visually hold sprites for impact, then interpolate back to current canonical state.

## 6. Client and Server Architecture

### Runtime split

- The existing Node.js, Express, Socket.IO, room-code, session-resume, static serving, LAN discovery, and health foundations remain.
- React owns the landing page, lobby, top bar, accessible HUD, reconnect overlay, result screen, and settings.
- Phaser 4.2.1 replaces the hand-written Canvas renderer and keyboard loop for the arena experience.
- `BootScene` loads and validates textures/audio. `ArenaScene` owns fighter views, platform view, effects, camera, input capture, and the render loop.
- A typed `GamePresentationBridge` is the only connection between React/network state and Phaser. It supplies snapshots/events and accepts normalized local inputs; Phaser scenes never import Socket.IO or mutate room state.
- The server simulation remains a pure TypeScript domain with no Phaser, React, DOM, or Socket.IO imports.

Phaser's physics engines are not authoritative. Cosmetic particles and presentation tweens may use client-only Phaser facilities, while all player movement, attack arcs, hits, knockback, ring-outs, and scores are calculated by the server's deterministic fixed-step simulation.

### Network cadence and prediction

- Server simulation: fixed 60 Hz with accumulated monotonic elapsed time and a maximum catch-up of five steps.
- Snapshot broadcast: 30 Hz.
- Client input: at most 60 frames per second; socket rate limit is 90 valid input messages per second.
- Local movement, facing, dash start, and attack-start animation are predicted immediately.
- The server alone confirms hits, overload, knockouts, score, respawn, countdown, sudden death, and result.
- Acknowledged inputs are removed and remaining inputs replay from the authoritative state.
- Remote players render approximately 70 milliseconds behind the newest snapshot using interpolation. Corrections above a tested snap threshold snap; smaller corrections blend without delaying hit events.
- A locally predicted attack rejected by canonical state exits cleanly into recovery without producing hit, score, or victim feedback.

### Protocol replacement

Client-to-server gameplay messages use:

- `lobby:chassis` — `{ chassis }`.
- `lobby:ready` — `{ ready }`.
- `match:start` — host-only, empty payload.
- `match:input` — `{ seq, moveX, moveY, aimX, aimY, quick, heavy, dash }`.
- Existing room creation, joining, resume, result-ready, and return-to-lobby events remain with revised room models.

Server-to-client gameplay messages use:

- `room:state` — host, connected/reserved players, chassis, accent, ready/result-ready, and phase.
- `match:started` — initial canonical match snapshot.
- `match:snapshot` — phase, tick, remaining time, arena contraction, players, scores, and last processed input sequence.
- `match:event` — typed `HIT`, `KNOCKOUT`, `RESPAWN`, `PHASE`, and `RESULT` events.
- `server:error` — typed Turkish recovery information.

Old team, core, delivery, reactor, tackle, and score-event fields are removed from types, schemas, fixtures, tests, and runtime code.

### Code boundaries

- `src/shared/` — schemas, protocol, fighter/arena constants, pure combat types, and shared geometry.
- `src/server/game/` — deterministic state creation, movement, attacks, hits, knockouts, respawns, and match transitions.
- `src/server/rooms/` — room/session lifecycle, chassis choice, ready/start/rematch rules, reconnect reservation, and host migration.
- `src/server/network/` — payload validation, acknowledgements, rate limits, and event broadcasting.
- `src/client/network/` — typed Socket.IO wrapper and resume handshake.
- `src/client/state/` — canonical room/match state and bridge-facing subscriptions.
- `src/client/game/` — Phaser boot, arena scene, view models, prediction/interpolation, effects, input, and audio.
- `src/client/ui/` — React landing, lobby, HUD, reconnect overlay, settings, and result screen.
- `public/assets/` — original fighter atlases, arena textures, effect textures, and short audio cues.
- `tests/` — unit, integration, load, browser, visual, and deterministic replay coverage.

## 7. Lobby, Session, and Recovery UX

### Landing

- Player name remains 2–16 normalized visible characters.
- `Oda Kur` and `Odaya Katıl` are clickable when attempted so missing/invalid name and room code errors appear beside the relevant field; validation must not fail silently behind an unexplained disabled button.
- Creating or joining retains entered values after recoverable errors.
- The four-character room code excludes ambiguous characters and is case-insensitive.

### Lobby

- Team columns and team switching are removed.
- Each player card shows name, host marker, connection/reservation state, selected chassis, accent color, and ready state.
- Chassis options show meaningful silhouettes rather than text-only radio controls.
- Changing chassis resets that player's ready state.
- The host can start with at least two connected players when every connected player is ready.
- The room supports up to eight connected or reconnect-reserved slots.

### Disconnect and resume

- `socket.id` is never identity. The random player ID and secret resume token model remains.
- Disconnect immediately releases held inputs and removes the player from collision/attack targeting.
- Disconnecting never subtracts score, increments falls, awards a knockout, or changes existing statistics. The player is simply removed from active simulation while reserved.
- The slot, score, chassis, accent, statistics, and identity remain reserved for 20 seconds.
- With at least two connected players, the match continues while a disconnected player is reserved.
- If fewer than two remain, the match pauses and displays the authoritative remaining reconnect time. The pause lasts while at least one reserved opponent still has a valid resume window.
- During this pause, the match clock, combat simulation, arena contraction, attacks, cooldowns, and respawn timers freeze; only session reservation deadlines advance.
- When no second player can validly resume, the interrupted match is declared `NO_CONTEST` and returns to the lobby without changing scores or statistics. No connected or disconnected player receives a win, loss, knockout, fall, or other penalty from the interruption.
- A valid resume reattaches to the same player. During a match, the player warp-enters at the deterministic safest spawn with their existing overload, score, and statistics. Control returns after a 180-millisecond visual entry and normal 650-millisecond protection applies; reconnecting itself is not punished.
- Invalid or expired tokens cannot claim a slot and produce a typed, actionable error.

### Results and rematch

- Results rank players by score, then fewer falls, then more landed hits, then stable join order.
- Every connected player toggles `Tekrar Hazır`; the host can start when all connected players are ready.
- A rematch resets match state and statistics but preserves membership, chassis, and accent assignments.
- Host-only `Lobiye Dön` resets ready states and returns all players to the lobby.

## 8. Visual, Audio, and Accessibility Direction

- The quiet dark sci-fi shell remains, but the arena becomes brighter, more legible, and less panel-heavy.
- The octagonal platform has a strong edge/void contrast and a clearly telegraphed contraction boundary.
- Player accents use an eight-color colorblind-conscious palette; identity never relies on color alone.
- HUD prioritizes timer, local overload, local dash/charge state, and compact per-player scores. There is no carried-core module.
- Primary action and current state must be understandable within three seconds on every non-game screen.
- Phaser renders the arena at device resolution with a capped DPR, correct resize handling, and stable letterboxing without clipping.
- A single user gesture unlocks audio. Separate master mute persists locally and stops all Phaser sounds immediately.
- Short original cues cover quick swing, heavy charge/release, confirmed hit, dash, knockout, respawn, countdown, warning, and victory.
- `prefers-reduced-motion` reduces camera and continuous motion. `prefers-reduced-transparency` receives stronger opaque contrast where supported.
- Non-game controls remain keyboard reachable with visible focus. Gameplay itself requires keyboard and mouse and communicates this before joining.
- Viewports below 900×600 show an explicit unsupported-size message instead of clipping controls or arena content.

## 9. Error Handling and Robustness

- Zod validates every socket boundary payload. Aim values must be finite; movement and aim vectors are normalized/clamped; unknown enum values and malformed action frames are rejected.
- Input sequence numbers are monotonic per player. Duplicate or older frames are ignored without mutating combat state.
- Rate-limit errors are typed and cannot crash or stall a room simulation.
- Scene boot displays a recoverable Turkish asset-load failure screen instead of a blank canvas.
- Phaser boots with automatic renderer selection so Canvas is used when WebGL is unavailable. A renderer context lost after boot offers a reload action while keeping session credentials.
- Audio-lock failures do not prevent gameplay.
- Connection loss keeps the last rendered frame under a reconnect overlay and releases input immediately.
- Server catch-up work is bounded; a slow room cannot create unbounded simulation debt.
- Every Phaser scene, timer, input listener, particle emitter, sound, store subscription, socket listener, and animation frame is disposed on scene/app teardown.
- Process signals stop schedulers and close Socket.IO and HTTP cleanly.
- Names render only through React text nodes or Phaser text after the shared normalization and length limit; no player-controlled HTML is used.
- Room codes and resume tokens continue to use cryptographically secure randomness.

## 10. Verification and Acceptance Gates

### Pure simulation and state

Unit tests must prove:

- acceleration, drag, maximum speed, dash direction, dash cooldown, and dash invulnerability;
- aim normalization and invalid-input rejection;
- each combo step's timing, buffering, single-hit-per-target rule, recovery, and miss behavior;
- heavy minimum/maximum charge, cancel-before-release, release commitment, range, and recovery;
- overload accumulation, impulse formula, hitstun, and non-decay during a life;
- attack rejection against invulnerable, knocked-out, disconnected, and out-of-range players;
- platform geometry, contraction, off-platform air control, knockout boundary, credit window, and self-fall;
- deterministic respawn selection, invulnerability, score target, timed win, and sudden death;
- knockout control returns at 700 milliseconds, protection cancels on attack, and no escalating or negative-score penalty exists;
- identical final state and ordered events for repeated simulation from the same seed and input sequence.

### Room and network

Tests must prove:

- room creation, code collisions, capacity including reservations, chassis validation, ready reset on chassis change, start rules, host migration, reconnect expiry, room deletion, result-ready, rematch, and return-to-lobby;
- two real Socket.IO clients can create, join, ready, start, exchange combat inputs, receive snapshots/hits, reach a result through an in-process-only `forceKnockout` test harness, and rematch;
- malformed aim/action payloads, unauthorized host actions, input flooding, stale sequence numbers, invalid tokens, and late joins are rejected safely;
- reconnect restores identity, score, statistics, and overload without awarding a fall/knockout; under-populated pause resolves to resume or `NO_CONTEST` cleanup as specified.

### Phaser and browser

Tests must prove:

- the React-owned Phaser mount creates exactly one game instance and destroys it without leaked listeners;
- snapshots create/update/remove fighter views, arena state, HUD values, and interpolation targets correctly;
- local input predicts movement/attack start but never fabricates a hit or score;
- `HIT`, `KNOCKOUT`, and `RESPAWN` events trigger the correct effect/audio contracts once;
- idle/move blending, uninterrupted combo chaining, knockout-to-control timing, and animation continuity across snapshots meet the millisecond contracts above;
- reduced-motion and mute settings alter presentation without changing game state;
- resize/DPR handling preserves the full 1280×720 logical arena at 1440×900, 1280×720, 1024×768, and 900×600;
- two isolated Playwright contexts complete create, join, chassis choice, ready, start, visible movement, one real attack exchange, forced-result test harness, result, and rematch without page or console errors;
- a real forced browser disconnect during a match shows countdown, resumes the same player, and returns through respawn.

### Load, performance, and live LAN

- Eight Socket.IO clients join one room, ready, start, and send legal 60 Hz movement/aim/action input for at least 10 seconds.
- Every client receives at least 250 snapshots, no unexpected `server:error`, and the server health endpoint stays responsive.
- The load test completes three consecutive runs without open handles or reserved players leaking between runs.
- On the development Mac, the 1440×900 browser gameplay scene maintains a measured median of at least 58 rendered frames per second and a 95th-percentile frame duration below 25 ms during an eight-fighter scripted effect burst.
- A recorded ten-second action sequence covering idle, movement, full combo, heavy strike, dash, hit reaction, knockout, and respawn shows no rigid sliding, unintended pose reset, one-frame disappearance, or resize-triggered animation restart.
- `npm run lan` performs a production build and starts the server in one command.
- `/health` returns HTTP 200 on localhost and one discovered non-loopback RFC1918 LAN address.
- Two real browser sessions complete a live match flow on the production build.
- README host/join instructions work verbatim on macOS and remain platform-neutral for Windows/Linux hosts with Node.js 20 or newer.

### Visual acceptance

The landing screen, lobby, active match, contraction warning, reconnect overlay, and result screen are inspected at every supported target viewport. Acceptance requires:

- no primitive placeholder fighter bodies, baked backgrounds, text clipping, overlap, or accidental wrapping;
- each chassis and action state is distinguishable at normal play scale;
- local player, opponents, platform edge, danger zone, attack arcs, and hit direction remain readable during an eight-player effect burst;
- hover, focus, active, disabled, loading, error, reconnecting, ready, and success states are all present and consistent;
- each confirmed hit visibly produces target displacement, a target pose/flash, directional particles, and overload feedback; camera response is also required unless reduced motion is active, and an audible contact cue is required unless muted;
- persistent HUD contains only the clock/phase, compact score ranking, local overload, dash/charge state, connection quality, and controls hint; rejected core/team modules and duplicated primary actions are absent.

## 11. Migration Strategy

The redesign proceeds in vertical slices so a working LAN flow exists after every slice:

1. Replace shared team/core models with chassis, FFA score, combat input, and event types; drive the new pure simulation with tests.
2. Adapt room/session/protocol rules and server integration while preserving create/join/reconnect foundations.
3. Mount a minimal Phaser arena against canonical snapshots and remove the hand-written Canvas renderer.
4. Add fighter assets and animation states, then authoritative hit/knockout feedback, audio, camera, and particles.
5. Replace lobby/HUD/result semantics, including visible field validation and reconnect/`NO_CONTEST` handling.
6. Complete load, browser, responsive, performance, README, and live-LAN gates.

Obsolete code paths, schemas, fixtures, tests, docs, and assets are deleted as their replacements land. No dual-mode switch or legacy fallback is introduced.

## 12. Delivery Definition

Neon Knockout is complete only when the current source and assets, clean install, lint, type checks, all automated tests, production build, three eight-client load runs, two-browser match/reconnect/rematch flow, supported viewport review, measured combat performance, live LAN health probe, and README instructions all pass against the same final commit.

Completion also requires merging the implementation into the repository's main branch, pushing it to the already-created public GitHub repository, and verifying that the local main commit exactly matches the remote default-branch commit. A locally passing or merely reachable build is not sufficient.
