# Review

## External Review

Reviewer: Claude via `codeagent-wrapper --backend claude`

Gemini was intentionally not called because the user explicitly said to ignore Gemini until it is configured.

## Findings

### Critical

- None.

### Warning

- `src/components/explorer/useExplorerDirectoryData.ts`: auto-retry failure can perform a redundant forced FDA probe because the retry path had just confirmed FDA was `granted`, then the failure classifier probes again.
  - Resolution: accepted. The extra probe only happens on the failed retry path and keeps classification conservative if TCC state changes between the unblock and the failed read.

### Info

- `refreshCurrentDir()` can still unblock and attempt a generic manual refresh without a pre-probe, but the dedicated FDA recovery retry button now probes first. This is acceptable because generic refresh is not the FDA recovery control and failure re-enters the normal classification path.
- Tests cover auto retry success, no-loop failure after FDA granted, and manual retry while FDA remains denied.
- Docs and spec match the new behavior.

## Verification

- `npm test -- src/__tests__/explorer-permission-auto-retry.test.tsx` passed: 1 file, 3 tests.
- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/explorer-permission-auto-retry.test.tsx src/__tests__/full-disk-access.test.ts src/__tests__/operation-permission-error.test.ts` passed: 4 files, 34 tests.
- `npm test` passed: 31 files, 289 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission model validation.
- `npm run lint:readme` passed.
- `npm run lint:i18n` passed.
- `npm run lint:ci-gates` passed.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.

## Remaining Acceptance Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.
