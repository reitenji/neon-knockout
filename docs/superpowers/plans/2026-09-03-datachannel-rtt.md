# WebRTC DataChannel RTT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sticky ICE-stat Ping with a server-timed, unique WebRTC DataChannel round trip that represents the application's real gameplay path.

**Architecture:** Reuse the existing one-second reliable DataChannel heartbeat instead of adding another protocol or timer. The server records when each heartbeat nonce is sent, accepts only the matching acknowledgement, computes RTT on the server clock, and publishes a median formed only from distinct acknowledged heartbeats. Socket.IO fallback Ping and the one-column HUD remain unchanged.

**Tech Stack:** TypeScript, Node.js, Werift, browser WebRTC DataChannels, Zod, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md` (Task 3 updates its obsolete ICE-stat Ping semantics)

## Global Constraints

- Keep the Node.js server authoritative; never accept a client-supplied duration or timestamp.
- Keep exactly one HUD field named `Ping`.
- Measure only acknowledged, matching-generation heartbeat nonces; never count a cached value twice.
- Do not change gameplay packets, simulation tick rate, WebRTC UDP ports, or Socket.IO fallback behavior.
- A missed latency sample must not independently disconnect a player; the existing three-missed-heartbeat fallback remains authoritative.

---

### Task 1: Prove unique server-timed heartbeat RTT

**Files:**
- Modify: `src/server/network/gameplayTransport/GameplayTransportHub.test.ts`
- Modify: `tests/integration/socketFlow.test.ts`

**Interfaces:**
- Consumes: existing reliable `heartbeat` / `heartbeat-ack` messages and injected `GameplayTransportHubOptions.now`
- Produces: tests proving one RTT sample per matching acknowledgement, server-clock timing, stale/wrong nonce rejection, and latest-five median behavior

- [ ] **Step 1: Replace the fake Werift-stat test with a failing heartbeat RTT test.**

  Drive fake time to send a heartbeat, advance by a known duration, acknowledge its exact nonce, and repeat with `[50, 10, 30, 100, 20, 0]`. Assert the published medians are `[50, 30, 30, 40, 30, 20]`. Send a duplicate and a wrong nonce between valid acknowledgements and assert neither creates a sample.

  ```ts
  await vi.advanceTimersByTimeAsync(1_000);
  const heartbeat = JSON.parse(peer.reliableSent.at(-1)!);
  await vi.advanceTimersByTimeAsync(50);
  peer.receiveReliable({
    version: 1,
    generationId: FIRST_GENERATION,
    kind: 'heartbeat-ack',
    nonce: heartbeat.nonce
  });
  expect(first.networkSamples).toEqual([{ medianMs: 50, sampledAt: 1_050 }]);
  ```

- [ ] **Step 2: Run the focused test and verify RED.**

  Run: `npx vitest run src/server/network/gameplayTransport/GameplayTransportHub.test.ts --maxWorkers=1`

  Expected: FAIL because heartbeat acknowledgements currently clear liveness state without recording RTT.

- [ ] **Step 3: Add an integration assertion for WebRTC heartbeat RTT.**

  Replace the fake peer's `rttSamples`/`sampleRttMs()` behavior with acknowledgement delays and assert the room snapshot receives the heartbeat-derived latest-five median. Retain the existing fallback assertion that the WebRTC value clears before Socket.IO samples resume.

- [ ] **Step 4: Run the integration test and preserve its RED evidence.**

  Run: `npx vitest run tests/integration/socketFlow.test.ts --maxWorkers=1`

  Expected: FAIL because the hub still reads candidate-pair stats.

### Task 2: Compute RTT from existing heartbeat acknowledgements

**Files:**
- Modify: `src/server/network/gameplayTransport/GameplayTransportHub.ts`
- Modify: `src/shared/gameplayTransport.ts`
- Modify: `src/server/network/gameplayTransport/ServerPeer.ts`
- Modify: `src/server/network/gameplayTransport/WeriftServerPeer.ts`
- Modify: `src/server/network/gameplayTransport/WeriftServerPeer.test.ts`
- Modify: `src/server/network/createGameServer.test.ts`
- Modify: `tests/integration/socketFlow.test.ts`

**Interfaces:**
- Consumes: `ServerReliableMessage { kind: 'heartbeat'; nonce }`, `ClientReliableMessage { kind: 'heartbeat-ack'; nonce }`, and `TransportSession.setNetworkSample(medianMs, sampledAt)`
- Produces: server-owned DataChannel application RTT with no `ServerPeer.sampleRttMs()` dependency

- [ ] **Step 1: Record the send time beside the pending heartbeat nonce.**

  Add `pendingHeartbeatSentAtMs: number | null` to each `SessionRecord`. Set it only after `sendReliable()` returns `sent`, reset it during negotiation/fallback/disposal, and overwrite it only when the next heartbeat is actually sent.

  ```ts
  record.pendingHeartbeatNonce = nonce;
  record.pendingHeartbeatSentAtMs = this.now();
  ```

- [ ] **Step 2: Record one sample when the exact acknowledgement arrives.**

  In `acceptReliableMessage`, require current peer, generation, pending nonce, and non-null send time. Compute `Math.round(Math.max(0, this.now() - sentAt))`, clear pending state first, then append the sample and publish the latest-five median through a small `recordRttSample()` helper.

  ```ts
  const sentAt = record.pendingHeartbeatSentAtMs;
  record.pendingHeartbeatNonce = null;
  record.pendingHeartbeatSentAtMs = null;
  record.missedHeartbeats = 0;
  if (sentAt !== null) this.recordRttSample(record, this.now() - sentAt);
  ```

- [ ] **Step 3: Remove the obsolete ICE-stat polling path.**

  Delete `RTT_SAMPLE_INTERVAL_MS`, `rttTimer`, `rttSampling`, `startRttSampling()`, and `sampleRtt()`. Remove `sampleRttMs()` from `ServerPeer`, `WeriftServerPeer`, and all fakes; delete tests that only validate candidate-pair stat selection. Keep `RTT_SAMPLE_LIMIT` and `RTT_FRESHNESS_MS` for distinct acknowledged heartbeat samples.

- [ ] **Step 4: Run focused tests and verify GREEN.**

  Run: `npx vitest run src/server/network/gameplayTransport/GameplayTransportHub.test.ts src/server/network/gameplayTransport/WeriftServerPeer.test.ts src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts --maxWorkers=1`

  Expected: all focused tests pass with no candidate-pair RTT polling left.

- [ ] **Step 5: Commit the behavior change.**

  ```bash
  git add src/shared/gameplayTransport.ts src/server/network/gameplayTransport src/server/network/createGameServer.test.ts tests/integration/socketFlow.test.ts
  git commit -m "fix: measure ping through data channel heartbeats"
  ```

### Task 3: Make the contract and browser evidence truthful

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md`
- Modify: `README.md`
- Modify: `tests/e2e/webrtcGameplay.spec.ts`

**Interfaces:**
- Consumes: heartbeat-derived `medianMs` in authoritative snapshots
- Produces: documented semantics and browser acceptance for a numeric Ping on both players

- [ ] **Step 1: Update the Ping contract.**

  Define WebRTC Ping as server-clock application RTT over the existing reliable DataChannel heartbeat. State explicitly that it includes browser and Node scheduling, unlike ICMP, and that only distinct matching acknowledgements enter the latest-five median.

- [ ] **Step 2: Strengthen browser acceptance without adding UI columns.**

  Keep the existing assertions that both player rows show one numeric Ping and no RTT/Delay/Rollback columns. Add a test-harness assertion that Ping becomes fresh only after WebRTC activation and clears/switches source on forced fallback.

- [ ] **Step 3: Run the complete verification suite.**

  Run: `npm run verify`

  Expected: lint, both TypeScript projects, all Vitest suites, the eight-client load gate, and production builds pass.

- [ ] **Step 4: Run real browser acceptance.**

  Run: `npx playwright test tests/e2e/webrtcGameplay.spec.ts --project=chromium`

  Expected: two Chromium clients activate WebRTC, both receive numeric Ping, gameplay remains authoritative, and forced fallback obtains a fresh Socket.IO Ping.

- [ ] **Step 5: Commit documentation and acceptance evidence.**

  ```bash
  git add README.md docs/superpowers/specs/2026-09-01-webrtc-gameplay-transport-design.md tests/e2e/webrtcGameplay.spec.ts
  git commit -m "docs: define data channel ping semantics"
  ```

### Task 4: Verify the physical LAN separately

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-datachannel-rtt.md`

**Interfaces:**
- Consumes: live port `4174`, physical phone, host Mac, router IP, and the new HUD Ping
- Produces: separate current evidence for Wi-Fi path RTT and in-game application RTT

- [x] **Step 1: Restart the production build on port 4174 and verify health.**

  Run: `curl -fsS http://127.0.0.1:4174/health`

  Expected: `status` is `ok`.

- [ ] **Step 2: Compare simultaneous measurements.**

  While the phone is awake in a match, measure Mac-to-router ICMP, Mac-to-phone ICMP, and HUD DataChannel Ping for at least 30 seconds. Record min/median/p95/max separately; do not infer one metric from another.

  - [x] Completed automated prerequisite: measured the confirmed default gateway from the host with 30 ICMP packets.
  - [ ] Pending physical comparison: no phone is identified, so phone ICMP and an in-match HUD DataChannel Ping have not been measured.

- [ ] **Step 3: Repeat once with the host connected by Ethernet or both devices forced onto the same access point.**

  A large improvement isolates Wi-Fi/mesh backhaul as the network cause. No improvement while ICMP remains low identifies browser/main-thread scheduling as the remaining application component.

- [x] **Step 4: Publish only after automated code/tests/browser evidence, live-host health, and final review are clean.**

  Push the verified commit to `feature/webrtc-gameplay-transport-impl` and `main`, then confirm both remote refs resolve to the same commit. Keep phone/HUD/Ethernet/same-access-point comparison explicitly pending and separate; under the binding ruling, it does not block publication once the automated evidence, live-host health, and final review are clean.

#### Outcomes and evidence — 2026-09-03T12:35:36+0300

- Current production artifacts in this worktree were validated before restart: `dist/server/main.js` and `dist/client/index.html` were present (built at `2026-09-03T12:26:46+0300` and `2026-09-03T12:26:45+0300` respectively); `node --check dist/server/main.js` succeeded; the server bundle contains `pendingHeartbeatSentAtMs` and `recordRttSample`, matching the heartbeat RTT source implementation.
- Restarted the existing `com.reitenji.neon-relay.lan` launchd job. Its PID changed from `94916` to `70126`. `launchctl print` records `cd /Users/serkances/dev/game/.worktrees/webrtc-gameplay-transport-impl && exec /Users/serkances/.nvm/versions/node/v25.9.0/bin/node dist/server/main.js`; `lsof` records that PID `70126` owns `TCP *:4174 (LISTEN)`. TCP `4173` has no listener.
- HTTP probes returned `200 OK` with expected JSON on both paths: `http://127.0.0.1:4174/health` and `http://192.168.68.52:4174/health` returned `{ "status": "ok", "rooms": 0, "uptimeSeconds": ... }`; both `/api/runtime/network` URLs returned `{ "port": 4174, "localUrl": "http://localhost:4174", "lanAddresses": [{ "interfaceName": "en0", "address": "192.168.68.52", "url": "http://192.168.68.52:4174" }] }`.
- `route -n get default` confirmed gateway `192.168.68.1` via `en0`. Host-to-gateway ICMP (`ping -c 30 -i 0.2 192.168.68.1`) received 30/30 packets with `0.0%` loss; exact round-trip `min/avg/max/stddev` was `3.647/15.811/45.346/12.213 ms`. This is an ICMP router-path result, not a DataChannel or phone RTT result.
- Task 3 verification evidence (recorded before this live check): `npm run verify` passed ESLint, both TypeScript projects, 59 Vitest files / 585 tests, the eight-client load gate, and production client/server builds. `npx playwright test tests/e2e/webrtcGameplay.spec.ts --project=chromium` passed three consecutive focused runs, each 2/2: `23.1 s`, `22.1 s`, and `24.0 s`. Those runs verified two Chromium clients, numeric WebRTC Ping after activation, authoritative gameplay, and a fresh Socket.IO Ping after forced fallback.
- Physical-device acceptance remains pending. No ARP neighbor was identified or probed as a phone. Consequently, phone ICMP, physical Safari/Chrome gameplay, in-match HUD Ping, Ethernet comparison, and same-access-point comparison are unverified. The automated two-Chromium evidence above is publishable under the ledger ruling, but it is not a substitute for those physical checks.
- After the stale-history review fix, root reran the complete gate on the final implementation: ESLint and both TypeScript projects passed, 59 Vitest files / 587 tests passed, the eight-client load gate passed, production client/server builds passed, and the focused Chromium acceptance passed 2/2. The freshly built service was restarted again as PID `15884`; TCP `4174`, both localhost/LAN health endpoints, and both runtime-network endpoints were verified while TCP `4173` remained closed.
- Root atomically published implementation commit `3a01c4ffc4e9da7632c433bfaf554d06902c26d2` to both `feature/webrtc-gameplay-transport-impl` and `main`; direct `git ls-remote` reads confirmed both refs resolved to that same commit. Phone/HUD/Ethernet/same-access-point comparison remains separately pending and does not block this automated verified publication under the binding ruling.
