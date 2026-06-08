# Extract Startup Permission Prompt Review

## Scope

- Extracted startup Full Disk Access modal UI into `src/components/StartupPermissionPrompt.tsx`.
- Kept permission probing, registration, polling, localStorage lock/state, Tauri invokes, and error normalization in `src/App.tsx`.
- Preserved startup permission user flow:
  - current app identity fields
  - `/Applications` stable install hint
  - Open System Settings
  - Reveal App in Finder
  - Check Authorization
  - loading and error states

## TDD

- RED: `npm test -- permission-ux` failed after adding structural assertions for `StartupPermissionPrompt`.
- GREEN: `StartupPermissionPrompt` was added and wired from `App.tsx`; `npm test -- permission-ux` passed with 13 tests.

## Review

- Gemini: not called, per user instruction.
- Claude-only review:
  - No Critical or Warning findings.
  - Confirmed component is presentational, callbacks are correctly wired, and permission behavior stayed in `App.tsx`.
  - Info only: `isStableApplicationInstallPath` is cheap enough to call during render; the `appPath` guard is defensively redundant but harmless.

## Verification

- `npm test -- permission-ux` passed: 13 tests.
- `npm run lint:ts` passed.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed.
- `npm test` passed: 26 files / 231 tests.

## Residual Risk

- This slice reduces frontend ownership complexity, but the overall permission UX goal still needs `docs/SMOKE_TEST.md` section `0.1` clean-user Full Disk Access acceptance on a release candidate before the goal can be marked complete.
