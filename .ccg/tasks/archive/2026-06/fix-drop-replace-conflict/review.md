# Review

## Root Cause

- Frontend conflict dialog buttons passed only `choice`, while `useExplorerTransferWorkflow.handleMoveConflictChoice` expected `(dialog, choice)`.
- Clicking Replace therefore entered the handler with `dialog = 'replace'` and no strategy, so it failed before starting the copy task.
- Backend replace copy path already supports overwriting a different target path; a positive regression test now covers it.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts`
- `npm run lint`
- `cargo test --lib`
- `npm run lint:rust`
- `git diff --check`
