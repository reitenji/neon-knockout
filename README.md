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

- `WASD` or arrow keys: move
- Mouse: aim
- Left mouse button: quick combo
- Hold and release right mouse button: charged heavy strike
- `Space`: dash

The arena requires a desktop viewport of at least 900 × 600 CSS pixels. All chassis have the same gameplay values. The first player to five knockouts wins; a normal knockout returns control in 700 ms.

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

It returns JSON with `status: "ok"` and the current room count. If it fails, check that the host command is still running. If the host probe works but a guest cannot connect, verify both devices are on the same private network, use the printed LAN URL exactly, and check the firewall rule. If the game shows a viewport warning, enlarge the browser window rather than using a mobile browser.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:load
npm run build
npm run test:e2e
npm run verify
```
