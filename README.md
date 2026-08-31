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
4. Each friend opens that LAN URL, enters a name and the four-character room code, selects a chassis, and chooses **Hazırım**.
5. The room host chooses **Maçı Başlat** when every connected player is ready.

The local host may use `http://localhost:4173`; other machines must use the printed private LAN URL, commonly in `192.168.x.x`, `10.x.x.x`, or `172.16–31.x.x`. Allow incoming TCP connections on port 4173 in the operating-system firewall when players cannot join. Guests only need a modern desktop browser after the host has installed dependencies.

## Controls

- `WASD`: move and aim, including normalized diagonals; releasing movement retains the last aim direction
- `J`: quick attack on each new key press
- Hold `K`: charge a heavy strike while steering with `WASD`; release `K` to attack
- `Space`: dash

Arrow keys, both `Shift` keys, mouse movement, and mouse buttons do not control the fighter. The arena requires a desktop viewport of at least 900 × 600 CSS pixels. All chassis have the same gameplay values. The first player to five knockouts wins; a normal knockout returns control in 600 ms, resets overload, and does not add any escalating penalty.

## Combat and match pacing

A heavy becomes available after 180 ms of charge. Releasing before the full 700 ms produces a melee-only heavy; reaching 700 ms also launches exactly one server-owned **Neon Pulse** in the locked direction. Pulses can hit a fighter or be broken by an active melee sweep. Equal quick attacks clash, equal heavies clash with stronger recoil, and a heavy defeats a quick without canceling the heavy. The first attack avoided during a dash is a **perfect dodge** and refunds part of that dash cooldown.

A regulation match lasts two minutes. The HUD warns at 78 seconds remaining, the platform begins contracting at 75 seconds, and it reaches minimum size at 40 seconds. A tied regulation result enters minimum-arena sudden death; only the next credited knockout wins, while an uncredited self-fall does not end the match.

## Reconnect behavior

Closing or losing a browser connection does not award a knockout or a fall. Keep the same tab open and the client automatically resumes its stored room identity when it reconnects during the grace window. If a player cannot return before that window expires, the remaining match may be declared no contest rather than treating the disconnect as a score.

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

`npm run verify` runs lint, both TypeScript checks, all Vitest suites, the ten-second eight-client load gate, and a production build. `npm run test:e2e` builds production code and runs the keyboard-only two-context combat journey plus the eight-context frame-budget gate.
