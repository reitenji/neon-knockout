# Neon Knockout

```sh
npm ci
npm run lan
```

Use Node.js 20 or newer. The host command builds the production client and starts the game server. It prints a localhost URL for the host machine and a private LAN URL for players on the same network. Open the printed LAN URL from another desktop browser; do not replace it with a public address. Neon Knockout does not provide WAN, Internet matchmaking, accounts, or a relay service.

## Host and join

1. On the host computer, run the two commands above.
2. The host opens the printed `http://localhost:4173` URL, enters a name, and chooses **Oda Kur**.
3. Share the visible four-character room code and the printed private LAN URL with up to seven friends.
4. Each friend opens that LAN URL, enters a name and the four-character room code, and selects a chassis.
5. The host chooses the room rules, every player chooses **Hazırım**, and the host chooses **Maçı Başlat** when every connected player is ready.

The local host may use `http://localhost:4173`; other machines must use the printed private LAN URL, commonly in `192.168.x.x`, `10.x.x.x`, or `172.16–31.x.x`. Allow incoming TCP connections on port 4173 in the operating-system firewall when players cannot join. Guests only need a modern desktop browser after the host has installed dependencies.

Only the current host can edit **Oda Ayarları**. Match duration can be **90 sn**, **2 dk**, or **3 dk**; the winning target can be **3**, **5**, **7**, or **10** knockouts. New rooms default to two minutes and five knockouts. Guests see the same server-owned values in read-only controls. A real settings change clears every player's ready state, and the selected pair persists through reconnects, host migration, returns to the lobby, and rematches.

## Controls

- `WASD`: move and aim, including normalized diagonals; releasing movement retains the last aim direction
- `J`: quick attack on each new key press
- Hold `K`: charge a heavy strike while steering with `WASD`; release `K` to attack
- `Space`: dash

Arrow keys, both `Shift` keys, mouse movement, and mouse buttons do not control the fighter. The arena requires a desktop viewport of at least 900 × 600 CSS pixels. All chassis have the same gameplay values. The first player to the room's configured knockout target wins; a normal knockout returns control in 600 ms, resets overload, and does not add any escalating penalty.

## Combat and match pacing

A heavy becomes available after 180 ms of charge. Releasing before the full 700 ms produces a melee-only heavy; reaching 700 ms also launches exactly one server-owned **Neon Pulse** in the locked direction. Pulses can hit a fighter or be broken by an active melee sweep. Equal quick attacks clash, equal heavies clash with stronger recoil, and a heavy defeats a quick without canceling the heavy. The first attack avoided during a dash is a **perfect dodge** and refunds part of that dash cooldown.

A regulation match lasts for the host-selected 90, 120, or 180 seconds. Arena contraction keeps the same pacing at every duration: warning/start/minimum happen at 58.5/56.25/30 seconds remaining for a 90-second match, 78/75/40 for the default 120-second match, and 117/112.5/60 for a 180-second match. A tied regulation result enters minimum-arena sudden death; only the next credited knockout wins, while an uncredited self-fall does not end the match.

## Reconnect behavior

Closing or losing a browser connection does not award a knockout or a fall. Keep the same tab open and the client automatically resumes its stored room identity when it reconnects during the grace window. If a player cannot return before that window expires, the remaining match may be declared no contest rather than treating the disconnect as a score.

## Leaving a room

**Odadan Çık** is available once in the top bar during the lobby, match, and result screens. A successful leave returns that player to the landing screen, removes the old room's resume authority, and keeps the live connection ready to create or join another room. If the host leaves, ownership moves to the earliest connected remaining player without changing the room rules; if the final player leaves, the room is removed. During an active match, a viable remaining group continues, while a population that can no longer support a match returns immediately to the lobby as no contest. Leaving from a result returns the remaining players to the lobby with the same settings and reset ready states.

## Platform notes

- macOS: allow the terminal application through the firewall if macOS asks.
- Windows: allow Node.js on private networks in Windows Defender Firewall.
- Linux: allow TCP port 4173 on the active private-network firewall profile.

If the LAN URL is absent, make sure the host has an active private network adapter. VPN, guest Wi-Fi isolation, captive portals, and corporate firewalls can block direct LAN connections. Stop an older local server already using port 4173 before running `npm run lan`.

## Health probe and troubleshooting

The host can confirm the server is listening with:

```sh
curl --fail http://127.0.0.1:4173/health
```

It returns JSON with `status: "ok"` and the current room count. Also run the same `/health` request against the exact private address printed by `npm run lan`, for example `curl --fail http://192.168.1.20:4173/health`; do not guess or hardcode that address. Both requests must return HTTP 200. If the host probe works but a guest cannot connect, verify both devices are on the same private network, use the printed LAN URL exactly, and check the firewall rule. If the game shows a viewport warning, enlarge the browser window rather than using a mobile browser.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:load
npm run build
npm run test:e2e
npm run verify
npx vitest run tests/integration/socketFlow.test.ts --maxWorkers=1
```

`npm run verify` runs lint, both TypeScript checks, all Vitest suites, the ten-second eight-client load gate, and a production build. `npm run test:e2e` builds production code and runs the keyboard-only two-context journeys plus the representative frame-budget gate: one real 1280 × 720 renderer with seven active lightweight Socket.IO participants, for eight authoritative players total.
