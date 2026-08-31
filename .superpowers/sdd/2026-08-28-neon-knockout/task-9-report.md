# Task 9 recovery report

## Checkpoints

- `32e386c` — `test: add eight-client socket load coverage`
  - `npx vitest run tests/load/eightClients.test.ts --maxWorkers=1` exited 0.
  - One file / one test passed in 13.54 s. The test starts an ephemeral websocket-only server, creates eight clients, drives ten seconds of legal 60 Hz input, asserts at least 250 snapshots per client, checks health/debug-room state, and closes every client/server in `afterEach`.

## Current E2E RED

The initial browser run first stopped before application execution because Playwright Chromium was absent. Chromium was installed with `npx playwright install chromium` outside the repository.

The subsequent narrow command:

```sh
npm run test:e2e
```

built the production client and server, then ran with one Playwright worker. The two-context journey reached create, join, chassis, ready, start, real movement, and a real quick hit. It failed at the reconnect assertion: server-initiated Socket.IO disconnect leaves the production client in the explicit `disconnected` state, so it needs the visible **Yeniden Dene** action to reconnect and resume. The captured assertion was `Expected: 2; Received: 1` for `debugRoom(...).connectedCount` after 12 seconds.

No production route or production test seam was added. The only harness use is the existing in-process `GameServer.testHarness`, which is not exposed over HTTP.

## Files staged in this recovery checkpoint

- `tests/e2e/fixtures.ts`
- `tests/e2e/knockout.spec.ts`
- `tests/e2e/performance.spec.ts`
- `playwright.config.ts`
- `package.json`
- `README.md`
- this report

The E2E suite is intentionally not claimed green. The next Task 9 continuation should first update the reconnect journey to press **Yeniden Dene**, re-run it alone, and only then continue the performance gate. Per user direction, no further test commands were started after this report.
