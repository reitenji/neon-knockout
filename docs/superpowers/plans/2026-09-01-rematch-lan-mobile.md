# Rematch, LAN Reliability, and Mobile Web ExecPlan

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while the work proceeds.

## Purpose / Big Picture

Neon Knockout must survive a rematch without requiring a browser refresh, make the correct LAN address visible inside the product, report useful connection quality, and become playable from a mobile browser. A player should be able to open the same URL on a phone, use landscape touch controls, and complete a match without covering the arena. Cloud/Firebase and WebRTC hosting are research-only in this slice; no cloud resources or Firebase configuration are created.

## Progress

- [x] (2026-09-01) Reproduced the rematch input lock and traced it to the socket-local input sequence gate.
- [x] (2026-09-01) Confirmed the running host LAN address can change while the old terminal URL becomes stale.
- [x] (2026-09-01) Audited ping semantics and the current desktop-only viewport/input path.
- [x] (2026-09-01) Added the failing rematch regression and moved input sequence allocation to the connection-lived arena bridge.
- [x] (2026-09-01) Added an in-product LAN share/diagnostics surface backed by live server network data, with every physical-interface link equally visible.
- [x] (2026-09-01) Added touch input, landscape match layout, safe-area handling, and compact mobile HUD.
- [x] (2026-09-01) Capped mobile rendering load and made fresh application RTT samples appear promptly without hiding sustained latency.
- [x] (2026-09-01) Ran focused tests, full verification, all production browser journeys, and localhost/private-LAN reachability probes.
- [x] (2026-09-01) Pushed the final reviewed result to the public GitHub repository.

## Surprises & Discoveries

- The production server was still healthy, but DHCP moved the host from `192.168.68.52` to `192.168.68.51`; the UI exposed only the room code, so guests could keep using an obsolete URL.
- `ArenaSession` starts each new mounted match at input sequence zero while `socketHandlers` retained the prior match's accepted sequence for the lifetime of the socket.
- The displayed ping is an application-level WebSocket round trip and therefore includes browser and server event-loop delay, not only radio/network latency.
- The app rejects every viewport below 900 by 600 and the input source is Phaser keyboard-only, so mobile support requires a real input source rather than a CSS-only change.

## Decision Log

- Decision: keep the server input gate monotonic for a socket's full lifetime and allocate client input sequences from the app-lived arena bridge.
  Rationale: an arena remount is a presentation boundary, not a connection boundary. Continuing the sequence removes the rematch lock without accepting delayed frames from the previous match.
- Decision: mobile means the same web application in Safari/Chrome, with portrait supported for menus and landscape required during play.
  Rationale: this meets the request without introducing native packaging and keeps desktop controls unchanged.
- Decision: touch movement and aim share the left joystick; quick, heavy hold/release, and dash use large right-side buttons.
  Rationale: it preserves the approved keyboard semantics while making attack direction controllable on touch.
- Decision: Firebase/Cloud Run/WebRTC deployment is excluded from implementation here.
  Rationale: the user explicitly requested research only. The code should keep simulation and transport boundaries clean but must not add speculative cloud abstractions.

## Context and Orientation

The authoritative server is under `src/server`; Socket.IO lifecycle handlers live in `src/server/network/socketHandlers.ts`. The React application and product screens are under `src/client`; the Phaser renderer and input pipeline are under `src/client/game/phaser`. `ArenaInput` converts an input source into protocol frames, `ArenaSession` predicts and sends those frames, and `ArenaScene` owns their lifecycle. Match HUD markup is in `src/client/ui/MatchHud.tsx`; responsive styles are in `src/client/styles/layout.css` and `src/client/styles/game.css`. Socket integration tests live in `tests/integration/socketFlow.test.ts`; production browser coverage lives in `tests/e2e/knockout.spec.ts`.

## Plan of Work

First preserve the rematch bug with a session-remount regression, then keep input sequence allocation above the per-match `ArenaSession`. The server retains its connection-lived monotonic gate, so delayed packets from the previous match cannot reopen a reset sequence window.

Next expose current private IPv4 URLs through a small same-origin runtime endpoint and render the primary share URL with copy/share affordances in the room flow. Keep the room code prominent and include concise diagnostics for firewall, guest Wi-Fi/client isolation, and stale IP failures. Do not promise that browser local-network permissions or transport fallbacks can bypass router isolation.

Then add a mutable touch control source whose state can be consumed by the existing `ArenaInput` path. Mount an accessible overlay in `PhaserArena`, capture pointer IDs, clear all held state on cancellation/blur/orientation change, and merge touch with the unchanged keyboard source. On small screens, menus scroll normally; the match requests landscape and displays a rotate prompt in portrait. Collapse the roster and combat status so controls do not hide the arena. Cap rendering at 60 fps and avoid excessive DPR on mobile-class viewports.

Finally sample application RTT as soon as a match becomes active and every two seconds thereafter, preserving the measured value rather than disguising sustained high latency. Prefer WebSocket with a tested Socket.IO polling fallback. Exercise two-browser rematch, mobile touch quick/heavy/dash, reconnect, room leaving, and LAN address copying. Run the complete repository gates, build production artifacts, restart the LAN process, probe localhost and the current private URL, then push only the intended changes.

## Concrete Steps

From `/Users/serkances/dev/game`:

1. Run the focused rematch integration test before and after the server fix.
2. Add focused unit/component tests for runtime LAN data, share UI, touch-state semantics, viewport/orientation behavior, and ping smoothing.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:load`, and `npm run build`.
4. Run the targeted production Playwright rematch and mobile journeys, then the full E2E suite when focused failures are resolved.
5. Start `node dist/server/main.js`, probe `/health` through localhost and the current private IPv4 address, and inspect the app in desktop and mobile browser sizes.
6. Commit and push `main` only after all required gates are green.

## Validation and Acceptance

- A connected host can finish a match, start a rematch, move, and perform at least two quick attacks without refreshing.
- The host can see and copy the current LAN URL and room code from the product; a stale prior address is not presented.
- Ping appears once measured, is compact on all screen sizes, and sustained 90 ms remains visible rather than being disguised.
- A phone-sized browser can create/join/ready in portrait, rotates for the match, and in landscape can move/aim, quick attack, hold/release heavy, and dash.
- Touch cancellation, losing focus, or changing orientation cannot leave a movement or attack stuck.
- Desktop WASD/J/K/Space behavior and room/result flows remain green.
- No Firebase, Cloud Run, Firestore, WebRTC, TURN, or other external resource is created or configured.

## Idempotence and Recovery

Tests and builds are repeatable. Runtime endpoint discovery reads current interfaces on demand and does not persist addresses. If the production port is occupied, identify the owning Neon Knockout process before stopping it; never kill an unrelated process. Preserve all pre-existing working-tree changes. If mobile changes destabilize desktop input, revert only the new touch-source wiring while retaining the rematch regression and LAN diagnostics.

## Outcomes & Retrospective

The rematch root cause was fixed at the client lifecycle boundary; room-wide server sequence resets were removed. The host lobby now shows every physical LAN URL without guessing which subnet guests use, development proxies the runtime endpoint, and the real client has WebSocket-first polling fallback. Mobile portrait lobby, landscape controls, safe areas, and compact HUD remain covered by production browser tests. Verification completed with 390 Vitest tests, the eight-client load gate, all production Playwright journeys, production builds, and live health probes through both localhost and `192.168.68.51`. The reviewed result is public at `https://github.com/reitenji/neon-relay`. Cloud hosting, Firebase, WebRTC, and TURN remain intentionally unimplemented.
