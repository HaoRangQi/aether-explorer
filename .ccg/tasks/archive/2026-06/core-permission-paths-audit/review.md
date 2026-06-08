# Core Permission Paths Audit

## Scope

Audited core file-operation paths against the MoleUI Full Disk Access model:

- Search/filter
- Preview/open/reveal/hash
- Rename/trash/compress/decompress/alias
- Copy/move/import transfer tasks
- Transfer and trash backend error mapping

## Findings

- Search is local filtering over the already-loaded directory listing, so it inherits directory browsing permission behavior.
- No `analyze-go` binary or Go scanner exists in this repository.
- Core operation toasts could still show raw permission strings because transfer task failures carried only plain `error` text and trash failures were often `Internal`.

## Changes

- Added shared frontend operation permission formatter in `src/lib/operation-permission-error.ts`.
- Operation failures now show FDA recovery wording only when all are true:
  - error classifies as `PermissionDenied`
  - a candidate path is under a known protected local root
  - current FDA probe is not `granted`
- Added `errorPath` to transfer task snapshots so frontend can classify failed copy/move/import tasks without parsing paths out of text.
- Transfer summaries now prefer permission-denied failures when selecting the representative error/path for mixed failure batches.
- Trash permission failures now return structured `PermissionDenied` instead of `Internal`.
- Removed the old folder-size completed+skipped FDA inference; root access failures now rely on explicit backend `PermissionDenied` errors.

## External Review

Gemini was intentionally not called per user instruction. Used Claude-only analysis and review.

Initial Claude analysis confirmed this was a real MoleUI-model gap for protected file operations.

Claude review:
- Critical: none.
- Warning: batch path selection and folder-size skipped-count heuristic.
- Action taken: fixed path selection and removed the skipped-count heuristic.

Claude follow-up review:
- Critical: none.
- Warning: none.
- Verdict: ready.

## Verification

Passed:

- `npx vitest run src/__tests__/operation-permission-error.test.ts`
- `npx vitest run src/__tests__/operation-permission-error.test.ts src/__tests__/permission-ux.test.ts src/__tests__/app-error.test.ts`
- `cargo test finish_move_transfer_task_preserves_failed_source_path`
- `cargo test permission`
- `npm test`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm run lint:ts`
- `npm run lint:readme`
- `npm run build`
- `npm run test:rust`
- `git diff --check`

## Residual Risk

The broader permission UX goal still requires clean-user macOS Full Disk Access acceptance evidence before it can be called complete.
