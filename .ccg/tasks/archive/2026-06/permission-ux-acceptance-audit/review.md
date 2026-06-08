# Review: permission-ux-acceptance-audit

## Scope

- Audited current permission UX implementation against the MoleUI FDA guidance.
- Added `get_app_identity` on the Rust diagnostics command surface.
- Rendered the current app name, Bundle ID, and version in Settings -> Permissions so users can match the exact Full Disk Access target in macOS System Settings.
- Preserved the existing FDA model: TCC-only probes, one shared frontend coordinator, no directory-level authorization fallback, no new privacy domains.

## Verification

- `npm test -- permission-ux`
- `npm run test:rust`
- `npm run lint:ts`
- `npm test`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm run lint:readme`
- `npm run build`
- `git diff --check`

## External Review

Claude-only review was run because this M / medium-risk slice changed Rust command wiring and the Settings permissions UI.
Gemini was intentionally skipped per the active user instruction to ignore Gemini in CCG workflows.

Claude reported no Critical findings. Reported Major items were reviewed:

- `checkPermissions` render-loop risk: false positive; `useFullDiskAccessPermission` memoizes `checkPermissions` with `useCallback`.
- unhandled `checkPermissions` rejection: false positive; `checkFullDiskAccessPermission` catches backend failures and records `unknown`.
- app identity source: addressed by preferring Tauri `product_name` before falling back to package name, so the UI shows the user-facing app name.
- existing hardcoded Rust diagnostics errors and reveal path validation were noted as pre-existing cleanup opportunities, not blockers for this slice.

## Residual Risk

The broader permission UX goal is still not fully closed until `docs/SMOKE_TEST.md` section `0.1` is executed on a clean macOS user / VM / disposable test machine and records Full Disk Access persistence, upgrade behavior, protected-directory operation behavior, and privacy-domain noise evidence.
