# Review

## Scope

- Added a Settings -> Permissions action to copy Full Disk Access acceptance evidence without opening DevTools.
- Extracted the shared evidence collector to `src/lib/full-disk-access-evidence.ts`.
- Reused the collector from both Settings and `window.__aether.permissionEvidence()`.
- Kept `window.__aether.smoke()` DEV-only.
- Kept evidence collection read-only by calling only `get_app_identity` and `full_disk_access_status`.
- Enforced TCC-only probe validation before returning copyable evidence.

## TDD / Implementation Notes

- Added source-level permission UX wiring tests before implementation.
- Added smoke/evidence validation coverage for TCC-only probes.
- After local review, added collector self-validation so Settings copy and `permissionEvidence()` reject user-content probes instead of only validating through the dev smoke path.
- Updated docs to prefer Settings -> Permissions copy evidence for release-candidate FDA acceptance evidence, with DevTools `permissionEvidence()` as fallback.

## External Review

- Gemini was not called, per task requirement.
- Claude-only review ran with `~/.claude/bin/codeagent-wrapper --backend claude`.
- Result: no Critical or Warning findings.
- Informational notes only:
  - DEV console hint for `permissionEvidence()` is only logged in dev builds.
  - Clipboard writes can fail in restricted contexts, but Settings catches and reports the error.
  - One source-level test checks setup call order even though both setup functions preserve `window.__aether` properties.

## Verification

- `npm test -- smoke` passed: 1 file / 5 tests.
- `npm test -- permission-ux` passed: 1 file / 15 tests.
- `npm run lint:ts` passed.
- `npm test` passed: 26 files / 236 tests.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed: 78 locale keys and 42 SettingsView high-risk usages verified.
- `npm run lint:readme` passed: 23 tracked headings match.
- `git diff --check` passed.

## Residual Risk

- Clean-user macOS Full Disk Access acceptance still requires manual execution of `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean user, VM, or disposable test machine.
