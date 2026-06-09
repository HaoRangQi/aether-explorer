# Review

## Scope

- `src/components/ExplorerView.tsx`
- `src/components/explorer/useExplorerDragDrop.ts`
- `src/components/explorer/useExplorerTransferWorkflow.ts`
- `src/__tests__/explorer-view-utils.test.ts`

## Findings

### Critical

- None found.

### Warning

- None found.

### Info

- Gemini was intentionally not called per user instruction.
- A local `ccg-review` agent was started with `fork_turns="none"` and completed without a usable report payload. Manual local review covered the diff and verification evidence.
- The repository has many pre-existing uncommitted source changes. Only the CCG task archive should be staged/committed by this task.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 23 tests.
- `npm run lint` passed: TypeScript, ESLint, macOS permission model validation.
- `npm test` passed: 31 test files, 350 tests.
- `npm run build` passed.
- `git diff --check` passed.

## Notes

- Directory navigation now resets DOM scroll and virtual list offsets through `resetDirectoryScrollState`.
- Internal Aether drag payloads now advertise copy semantics by default (`cut: false`, `effectAllowed = "copy"`, `dropEffect = "copy"`).
- Same-window internal drag and internal payload drops now route through copy operations; explicit cross-window move remains available through existing move paths.
