# Folder-Size Permission UX Audit

## Scope

Audited and patched the folder-size/inspector scan path so protected local directories use the same Full Disk Access recovery model as directory browsing.

## Changes

- `start_dir_size_task` and `get_dir_size` now validate that the root directory is readable before reporting size results.
- Root directory read failures in the progress scanner return structured `AppError` instead of being folded into `skipped_count`.
- The inspector reuses the shared Full Disk Access coordinator for protected folder-size scan failures.
- Folder-size permission errors are shown directly in the preview panel instead of being hidden behind a `--` placeholder.
- Added TS wiring coverage and a Rust regression test for unreadable root directories.

## External Review

Gemini was intentionally not called per user instruction because it is not configured. Used Claude-only review.

Initial Claude review:
- Critical: none.
- Warning: async race risk while resolving FDA status for directory-size snapshots.
- Action taken: added a disposal/request guard after awaiting `resolveDirectorySizeTaskSnapshot`.

Follow-up Claude review:
- Critical: none.
- Warning: none.
- Verdict: approve.

## Verification

Passed:

- `npx vitest run src/__tests__/permission-ux.test.ts`
- `cargo test get_dir_size_rejects_unreadable_root_with_permission_error`
- `npm test`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm run lint:ts`
- `npm run lint:readme`
- `npm run build`
- `npm run test:rust`
- `git diff --check`

## Residual Risk

The overall Full Disk Access goal still requires the documented clean-user macOS acceptance pass before the broader permission UX can be called complete.
