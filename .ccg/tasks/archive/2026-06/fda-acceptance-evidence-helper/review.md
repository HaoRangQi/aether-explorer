# FDA Acceptance Evidence Helper Review

## Scope

- Added dev-only `window.__aether.permissionEvidence()` to collect clean-user Full Disk Access acceptance evidence.
- Evidence includes:
  - `capturedAt`
  - current app identity (`appName`, `bundleIdentifier`, `version`, `appPath`)
  - Full Disk Access `status` and `probes`
  - runtime window label, user agent, and URL
- The helper only invokes `get_app_identity` and `full_disk_access_status`.
- No permission grant, reset, mutation, user-content probe, or new privacy domain was added.

## TDD

- RED: `npm test -- smoke` failed after adding tests for `validateFullDiskAccessAcceptanceEvidence`.
- GREEN: `src/lib/smoke.ts` now validates and exposes FDA acceptance evidence; `npm test -- smoke` passed with 4 tests.

## Review

- Gemini: not called, per user instruction.
- Claude-only review:
  - No Critical or Warning findings.
  - Confirmed TCC-only probe validation, dev-only exposure, no user directory access, and docs requiring real clean-user acceptance.
  - Info suggestion applied: DevTools console message now says `permissionEvidence()` collects FDA acceptance evidence.

## Verification

- `npm test -- smoke` passed: 4 tests.
- `npm test -- permission-ux` passed: 13 tests.
- `npm run lint:ts` passed.
- `npm run lint:i18n` passed.
- `npm run lint:eslint` passed.
- `npm test` passed: 26 files / 233 tests.
- After the final console message clarity patch:
  - `npm test -- smoke` passed: 4 tests.
  - `npm run lint:ts` passed.

## Residual Risk

- This improves evidence capture for the release gate, but it does not replace the required `docs/SMOKE_TEST.md` section `0.1` clean-user Full Disk Access acceptance run on a release candidate.
