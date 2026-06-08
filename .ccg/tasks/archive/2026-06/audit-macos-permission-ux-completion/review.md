# Review

## Claude-Only Analysis

- Backend: Claude via `~/.claude/bin/codeagent-wrapper --backend claude`
- Result:
  - Critical gaps: none.
  - Warnings / likely UX regressions: none detected in the current implementation.
  - Remaining evidence that cannot be produced locally: clean-user Full Disk Access acceptance on a fresh macOS user / VM / test machine with a stable signed release candidate.

## Local Audit Finding

- `docs/RELEASE_AUDIT.md` still contained stale permission guidance:
  - future entitlements example included directory-scoped sandbox permissions and Apple Events,
  - FDA probe example used `~/Library/Safari/History.db`.
- This contradicted `.ccg/spec/guides/index.md` and could mislead future release or permission work.

## Claude-Only Review Of Documentation Fix

- Backend: Claude via `~/.claude/bin/codeagent-wrapper --backend claude`
- Initial result:
  - Critical: none.
  - Major:
    - strengthen the forbidden permission wording so it applies to any code path, not only the core path,
    - explicitly state that TCC database paths are the defining FDA probe, not a proxy for user-content probes.
  - Minor:
    - clarify TCC client identity wording,
    - split the long test command into categories.

## Resolution

- Updated `docs/RELEASE_AUDIT.md` to:
  - treat stable signing identity as a release-candidate gate,
  - keep non-sandbox FDA-first entitlements,
  - forbid directory-scoped sandbox entitlements and Apple Events in any code path,
  - remove the Safari-history FDA probe example,
  - explain that TCC database paths are the defining Full Disk Access evidence,
  - keep clean-user FDA acceptance evidence as the remaining non-local gate.

## Verification

- `npm run lint:readme`: passed.
- `npm run lint:ci-gates`: passed.
- `npm run lint:macos-permissions`: passed.
- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/full-disk-access.test.ts src/__tests__/operation-permission-error.test.ts src/__tests__/macos-permission-model-validator.test.ts src/__tests__/macos-app-bundle-validator.test.ts src/__tests__/fda-evidence-validator.test.ts src/__tests__/smoke.test.ts src/__tests__/macos-permission-release-evidence-validator.test.ts`: 8 files / 77 tests passed.
- `git diff --check`: passed.
- Targeted `rg` check found no remaining Safari probe example or old `check_full_disk_access` guidance in `docs/RELEASE_AUDIT.md`.
