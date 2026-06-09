# Review

## External Review

Reviewer: Claude via `codeagent-wrapper --backend claude`

Gemini was intentionally not called because the user explicitly said to ignore Gemini until it is configured.

## Findings

### Critical

- `src/components/explorer/useExplorerDirectoryData.ts`: the FDA polling effect still listed `refreshCurrentDir` in its dependency array even though the effect no longer calls it. This could restart the polling interval unnecessarily.
  - Resolution: removed `refreshCurrentDir` from that effect dependency array.

### Warning

- Claude suggested replacing closure `currentPath` with `currentPathRef.current` inside the async main directory load catch.
  - Resolution: not applied. That block is handling a specific in-flight request. The closure path plus `requestId` guard is the safer pairing; using the mutable ref before the stale-request guard could classify an old failure against a newer path.

### Info

- Added comments explaining the `flushEffects(8)` settling helper in the new behavior tests.
- Docs and tests agree that FDA-granted retry failure becomes a normal directory read failure rather than another FDA recovery.

## Verification

- `npm test -- src/__tests__/explorer-permission-auto-retry.test.tsx` passed.
- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/explorer-permission-auto-retry.test.tsx src/__tests__/full-disk-access.test.ts src/__tests__/operation-permission-error.test.ts` passed: 4 files, 32 tests.
- `npm test` passed: 31 files, 287 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission model validation.
- `npm run lint:readme` passed.
- `npm run lint:i18n` passed.
- `npm run lint:ci-gates` passed.
- `npm run lint:macos-permissions` passed.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.

## Remaining Acceptance Gap

This task improves the automated and documented permission UX, but the broader user goal is not complete until `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` is executed on a clean macOS user, VM, or disposable machine and the FDA evidence JSON validates against the release candidate.
