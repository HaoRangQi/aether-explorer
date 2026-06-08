# Review

## Scope

- Added `force?: boolean` to `src/lib/full-disk-access.ts`.
- Kept in-flight single-flight behavior before cache lookup.
- Kept default short-cache behavior for passive checks.
- Forced fresh FDA probes for user-driven recovery and PermissionDenied classification paths.
- Updated regression tests and test-plan documentation.

## External Analysis / Review

- Gemini was not called.
- Claude-only analysis ran before implementation and recommended:
  - `force` and `registration` should be orthogonal,
  - registration should keep selecting `register_full_disk_access`,
  - forced/default concurrent calls should still single-flight,
  - tests should cover force cache bypass, force+registration, and mixed forced/default in-flight calls.
- Claude-only review ran after implementation.
- Review result: no Critical or Warning findings.
- Informational suggestion accepted: JSDoc now clarifies that registration probes also bypass the cache so macOS sees the current app identity.

## Verification

- `npm test -- full-disk-access` passed: 1 file / 9 tests.
- `npm test -- permission-ux` passed: 1 file / 16 tests.
- `npm test -- operation-permission-error` passed: 1 file / 3 tests.
- `npm run lint:ts` passed.
- `npm test` passed: 26 files / 240 tests.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed: 78 locale keys and 42 SettingsView high-risk usages verified.
- `npm run lint:readme` passed: 23 tracked headings match.
- `git diff --check` passed.

## Residual Risk

- This slice improves probe freshness but does not complete the required clean-user FDA acceptance run.
- The long-term goal remains incomplete until `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` is executed on a clean macOS user, VM, or disposable test machine and recorded.
