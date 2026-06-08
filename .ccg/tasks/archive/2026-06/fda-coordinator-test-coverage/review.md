# Review: FDA Coordinator Test Coverage

## RED / GREEN

- RED: `npm test -- src/__tests__/smoke.test.ts src/__tests__/full-disk-access.test.ts` failed because `validateFullDiskAccessSmokeResult` was missing.
- GREEN: Implemented `validateFullDiskAccessSmokeResult` and reused it from DevTools smoke.

## Coverage Added

- `src/__tests__/full-disk-access.test.ts`
  - single-flight concurrent checks
  - short cache for non-registration checks
  - registration checks bypass cache
  - backend failure records `unknown` snapshot state
  - subscription notification and unsubscribe behavior
  - hook consumer updates and stable `checkPermissions` callback
- `src/__tests__/smoke.test.ts`
  - accepts TCC-only FDA probe results
  - rejects user-content folder probes

## Verification

- `npm test -- src/__tests__/smoke.test.ts src/__tests__/full-disk-access.test.ts`: passed, 2 files / 6 tests.
- After review fixes: `npm test -- src/__tests__/full-disk-access.test.ts src/__tests__/smoke.test.ts`: passed, 2 files / 8 tests.
- `npm test`: passed, 25 files / 225 tests.
- `npm run lint:ts`: passed.
- `npm run lint:eslint`: passed.
- `npm run lint:readme`: passed.
- `npm run lint:i18n`: passed.
- `npm run build`: passed.
- `npm run test:rust`: passed, 127 Rust tests.
- `git diff --check`: passed.

## Claude-Only Review

Gemini was not called.

First Claude review:

- Critical: none.
- Major: missing subscription/unsubscribe coverage; missing hook consumer/callback stability coverage.
- Minor: smoke TCC path matching could be stricter; optional error field type check; first-run FDA smoke note missing.

Resolution:

- Added subscription/unsubscribe test.
- Added hook consumer update and stable callback test.
- Tightened TCC path validation to path-component matching.
- Validated optional `error` field as undefined/null/string.
- Documented that first-run `denied` or `unknown` FDA status is normal before grant.

Second Claude review:

- Critical: none.
- Warning: none.
- Prior Major findings verified resolved.

## Residual Risk

Real macOS FDA behavior still depends on `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收`.
