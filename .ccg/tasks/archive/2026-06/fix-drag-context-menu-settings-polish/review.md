# Review

## Scope

- Fixed explorer drag/drop move wiring by passing current selected file ids and file lookup into the transfer workflow callback.
- Added file context menu actions for opening the target folder in a new tab or new window.
- Added blank-area "Paste as txt" action that reads clipboard text and creates a timestamp-named `.txt` file.
- Changed default font back to System Default (`system-ui, sans-serif`) and kept the settings dropdown label stable.
- Reworked the Full Disk Access diagnostics card layout without changing permission semantics.

## Findings

- Critical: none found in local review.
- Warning: external CCG double-model review was downgraded. Gemini was not called per user constraint. Claude wrapper exited with status 1 before producing review content. A read-only explorer review agent completed without returning a report body, so this task relies on automated checks and local source review.
- Info: docs still mention the old Vitest case count (`334`); left unchanged because the user requested code-related changes only.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts src/__tests__/settings.test.ts`
- `npm test`
- `npm run lint`
- `npm run lint:i18n`
- `npm run lint:readme`
- `npm run lint:ci-gates`
- `cargo test --lib` in `src-tauri`
- `npm run lint:rust`
- `npm run build`
- `git diff --check`
