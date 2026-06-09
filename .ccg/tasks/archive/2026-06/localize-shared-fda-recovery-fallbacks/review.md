# Review

## External Review

Reviewer: Claude via `codeagent-wrapper --backend claude`

Gemini was intentionally not called because the user explicitly said to ignore Gemini until it is configured.

## Findings

### Critical

- None.

### Warning

- None.

### Info

- `src/lib/operation-permission-error.ts` and `src/components/explorer/useExplorerInspector.ts` now use English fallback copy for FDA recovery strings while the real localized user-facing copy remains in `en.ts` and `zh.ts`.
- `scripts/check-i18n-coverage.mjs` now validates 3 Full Disk Access recovery source usages.
- `permission-ux.test.ts` prevents the previous Chinese fallback literals from returning to shared permission paths.
- No FDA behavior changed: permission classification, forced probes, blocked retry, and one-shot auto retry are unchanged.

## Verification

- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/operation-permission-error.test.ts` passed: 2 files, 24 tests.
- `npm test` passed: 31 files, 291 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission model validation.
- `npm run lint:readme` passed.
- `npm run lint:i18n` passed: 77 locale keys, 24 ExplorerView usages, 3 Full Disk Access recovery usages, 12 AIRenamePanel usages, 4 app diagnostics usages, 7 settings diagnostics usages, 15 settings backup usages, 42 SettingsView high-risk usages, and 10 shortcut help usages.
- `npm run lint:ci-gates` passed.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.

## Remaining Acceptance Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.
