# Analysis

## Baseline

MoleUI FDA baseline requires clean-user evidence before claiming the permission UX is closed. Aether already exposes copyable FDA evidence from Settings and `window.__aether.permissionEvidence()`, but the saved JSON needed an objective offline gate for release acceptance.

## Implementation

- Added `scripts/validate-fda-evidence.mjs`.
- Added `npm run validate:fda-evidence -- /path/to/fda-evidence.json`.
- The validator fails when:
  - evidence is not JSON,
  - required `capturedAt`, `appIdentity`, `fullDiskAccess`, or `runtime` fields are missing,
  - `fullDiskAccess.status` is not `granted`,
  - no probe is readable,
  - probes are not canonical TCC paths.
- Accepted probe paths are restricted to:
  - `/Library/Application Support/com.apple.TCC`
  - `/Library/Application Support/com.apple.TCC/TCC.db`
  - `/Users/<user>/Library/Application Support/com.apple.TCC`
  - `/Users/<user>/Library/Application Support/com.apple.TCC/TCC.db`
- Runtime evidence validation in `src/lib/full-disk-access-evidence.ts` now mirrors the same path rule.
- Added `src/__tests__/fda-evidence-validator.test.ts` for CLI validation behavior.
- Hardened `src/__tests__/smoke.test.ts` to reject arbitrary nested paths under the TCC directory.
- Updated `docs/SMOKE_TEST.md` and `docs/TEST_PLAN.md` so clean-user FDA evidence includes running the validator after saving JSON.
- Updated `.ccg/spec/guides/index.md` with the new release evidence rule.

## Remaining Boundary

This task does not collect or fake FDA evidence. The main permission UX goal is still not complete until `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` is executed on a clean macOS user / VM / disposable test machine and the saved evidence JSON passes this validator.

## Verification

- `npm test -- fda-evidence-validator smoke`: passed, 2 files / 14 tests
- `npm run validate:fda-evidence -- <valid sample JSON>`: passed
- `npm test`: passed, 27 files / 250 tests
- `npm run lint:ts`: passed
- `npm run lint:eslint`: passed
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `npm run lint:ci-gates`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
