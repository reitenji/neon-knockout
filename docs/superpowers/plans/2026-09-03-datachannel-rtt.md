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

- [ ] **Step 1: Restart the production build on port 4174 and verify health.**

  Run: `curl -fsS http://127.0.0.1:4174/health`

  Expected: `status` is `ok`.

- [ ] **Step 2: Compare simultaneous measurements.**

  While the phone is awake in a match, measure Mac-to-router ICMP, Mac-to-phone ICMP, and HUD DataChannel Ping for at least 30 seconds. Record min/median/p95/max separately; do not infer one metric from another.

- [ ] **Step 3: Repeat once with the host connected by Ethernet or both devices forced onto the same access point.**

  A large improvement isolates Wi-Fi/mesh backhaul as the network cause. No improvement while ICMP remains low identifies browser/main-thread scheduling as the remaining application component.

- [ ] **Step 4: Publish only after both automated and live probes are recorded.**

  Push the verified commit to `feature/webrtc-gameplay-transport-impl` and `main`, then confirm both remote refs resolve to the same commit.
