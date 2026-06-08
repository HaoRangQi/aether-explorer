# Release Permission Evidence Helper Review

## Scope

- `window.__aether.permissionEvidence()` is now registered outside the DEV-only smoke runner so release candidates can collect FDA acceptance evidence.
- `window.__aether.smoke()` remains DEV-only.
- The helper remains read-only and only invokes `get_app_identity` and `full_disk_access_status`.
- TCC-only FDA probe validation remains in `validateFullDiskAccessSmokeResult`.
- Docs now distinguish release-safe evidence capture from DEV-only smoke checks.

## TDD

- RED: `npm test -- permission-ux` failed after adding a source-level test requiring a separate `setupAetherPermissionEvidence()` outside the DEV smoke setup.
- GREEN: `src/lib/smoke.ts` now calls `setupAetherSmokeDevtools()` and then `setupAetherPermissionEvidence()`, allowing release evidence capture while keeping smoke DEV-only.

## Review

- Gemini: not called, per user instruction.
- Claude-only review:
  - No Critical or Warning findings.
  - Confirmed DEV/release boundary, read-only behavior, TCC-only validation, and docs consistency.
  - Info-only notes about app path and href in evidence were accepted because both are intentional acceptance evidence fields.

## Verification

- `npm test -- permission-ux` passed: 14 tests.
- `npm test -- smoke` passed: 4 tests.
- `npm run lint:ts` passed.
- `npm test` passed: 26 files / 234 tests.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed.
- `npm run lint:readme` passed.
- `git diff --check` passed.

## Residual Risk

- This makes the evidence helper available in release candidates, but it still does not replace the required clean-user FDA acceptance run in `docs/SMOKE_TEST.md` section `0.1`.
