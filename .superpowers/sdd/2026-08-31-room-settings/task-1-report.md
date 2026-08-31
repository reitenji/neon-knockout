# Task 1 Implementation Report

## Outcome

Task 1 defines the exact room-rule options, default pair, proportional match-timing helper, strict `lobby:settings` payload, and strict acknowledged `room:leave` payload. The implementation is committed as `b3e0f05` (`feat: define authoritative room settings`).

## Files changed

- `src/shared/roomSettings.ts`
- `src/shared/roomSettings.test.ts`
- `src/shared/protocol.ts`
- `src/shared/protocol.test.ts`

The implementation commit contains exactly these four owned files.

## Behavior implemented

- Supported durations are exactly 90,000, 120,000, and 180,000 ms.
- Supported knockout targets are exactly 3, 5, 7, and 10; the default pair remains 120,000 ms and five knockouts.
- `matchTimingFor` derives the warning, contraction-start, and minimum-arena milestones from 13/20, 5/8, and 1/3 of the selected duration.
- `lobbySettingsSchema` accepts all 12 approved pairs and rejects unsupported values, missing fields, and unknown fields.
- `roomLeaveSchema` accepts only `{}` and rejects unknown fields.
- `ClientToServerEvents` exposes acknowledged `lobby:settings` and `room:leave` requests.

## TDD evidence

### RED

The room-settings module and its tests were already present as an uncommitted draft when this implementation assignment began, so this report does not fabricate a new module-missing RED for that inherited slice.

The leave contract was added test-first. Before `roomLeaveSchema` or the event existed, this command was run:

```text
npx vitest run src/shared/roomSettings.test.ts src/shared/protocol.test.ts --maxWorkers=1
```

Observed result: exit 1; one file failed and one passed, with 1 failed and 14 passed tests. The new test failed at `protocol.roomLeaveSchema.parse({})` because `roomLeaveSchema` was undefined. No production leave schema/event existed at that point.

### GREEN

After the minimum strict schema/type/event implementation, the same command passed: 2 files and 15 tests, 0 failures.

## Verification

The implementation commit `b3e0f05` was checked in an isolated detached worktree so unrelated in-progress Task 2 changes could not influence the result:

- Focused Task 1 suite: 2 files, 15 tests, exit 0.
- `npm run typecheck`: both TypeScript projects, exit 0.
- `npm run lint -- --quiet`: exit 0.
- `git diff --check`: exit 0.
- `git show --check b3e0f05`: no whitespace findings.

An earlier full typecheck in the shared dirty worktree correctly reported missing `settings` fields in several client `MatchSnapshot` fixtures owned by the in-progress Task 2 model migration. The only owned diagnostic in that run was Vitest table inference in `roomSettings.test.ts`; changing the literal matrix to a const tuple resolved it. The isolated commit typecheck proves Task 1 itself is clean.

## Scope review

- No model, simulation, room manager, client, plan/spec, README, generated artifact, or running LAN server was changed by this task.
- Pre-existing future-Task-2 hunks in the working copy of `protocol.test.ts` were deliberately excluded from `b3e0f05` by interactive hunk staging.
- Other agents' dirty files, plus `.playwright-cli/` and `output/`, were preserved untouched and unstaged.

## Concerns

No scoped implementation blocker remains. Spec and quality review are intentionally pending for the controller's next SDD gates.
