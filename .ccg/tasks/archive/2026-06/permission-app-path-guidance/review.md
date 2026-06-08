# Review: permission-app-path-guidance

## Scope

- Added app path to the Settings -> Permissions app identity surface.
- Added non-blocking stable install guidance when Aether is running outside `/Applications` or `/System/Applications`.
- Changed `get_app_identity` to return `Result<AppIdentity, AppError>` so executable lookup failures surface through the existing frontend identity error state.
- Added a reveal-button loading state to avoid repeated Finder reveal requests.
- Did not add reset, `tccutil`, directory-level authorization fallback, new privacy domains, or automatic permission-changing behavior.

## TDD

- Route: strict.
- RED: `npm test -- permission-ux` failed after adding assertions for `settings.permissions.appPath`, `settings.permissions.stableInstallHint`, `Result<AppIdentity, AppError>`, and `revealAppLoading`.
- GREEN: the same targeted test passed after implementation.

## Verification

- `npm test -- permission-ux`
- `npm run lint:ts`
- `npm run test:rust`
- `npm test`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm run lint:readme`
- `npm run build`
- `git diff --check`

## External Review

Claude-only review was run because this M / medium-risk slice changed Rust command wiring and the Settings permissions UI.
Gemini was intentionally skipped per the active user instruction to ignore Gemini in CCG workflows.

Review history:

- First Claude review found hardcoded Chinese errors in the touched diagnostics commands and missing coordinator context in the review input.
- Second Claude review, with `src/lib/full-disk-access.ts` included, found `get_app_identity` should surface `current_exe()` failures instead of returning an empty path.
- Final Claude review reported no Critical or Major findings.

## Residual Risk

The broader permission UX goal is still not fully closed until `docs/SMOKE_TEST.md` section `0.1` is executed on a clean macOS user / VM / disposable test machine and records Full Disk Access persistence, upgrade behavior, protected-directory operation behavior, and privacy-domain noise evidence.
