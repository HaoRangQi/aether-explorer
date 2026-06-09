# Review

## Root Cause

Plain Finder/system file drops carry the `Files` drag type. The drop handlers read the stored Aether internal drag payload before classifying those drops as external imports. If stale internal drag state existed, a plain external drop could consume that payload and route through move handling.

## Fix

- Added explicit external-file-drop classification.
- Plain `Files` drops now bypass stored internal drag payload reads.
- External drops into the surface and into folders route to `importExternalPaths`, which uses copy semantics.
- Aether internal drags remain authoritative only when `application/x-aether-file-paths` is present.

## Review

Local `ccg-review` found no Critical issues.

Warning addressed:
- Added hook-level tests proving plain `Files` drops call `importExternalPaths` and do not call `getFileDragPayload` or move handlers.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts`: passed, 19 tests.
- `npm run lint`: passed.
- `npm test`: passed, 31 files / 346 tests.
- `git diff --check`: passed.
- `npm run build`: passed.
- `npm run lint:i18n`: passed.
- `cd src-tauri && cargo test --lib`: passed, 129 tests.

## Notes

- Gemini was not called per user instruction.
- macOS permission model was not changed.
