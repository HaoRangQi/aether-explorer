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

- `src/components/explorer/useExplorerDirectoryData.ts` now uses `t('dialogs.permissionRetryBlockedDetail')` with an English fallback instead of a hardcoded Chinese string.
- `dialogs` is the right locale namespace because the surrounding permission error title, description, retry button, and steps already live there.
- `scripts/check-i18n-coverage.mjs` now checks both the key and source usage.
- `permission-ux.test.ts` guards against reintroducing the old hardcoded Chinese text.
- FDA recovery behavior is unchanged; only the message source changed.

## Verification

- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/explorer-permission-auto-retry.test.tsx` passed: 2 files, 23 tests.
- `npm test` passed: 31 files, 290 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission model validation.
- `npm run lint:readme` passed.
- `npm run lint:i18n` passed: 75 locale keys, 24 ExplorerView usages, 12 AIRenamePanel usages, 4 app diagnostics usages, 7 settings diagnostics usages, 15 settings backup usages, 42 SettingsView high-risk usages, and 10 shortcut help usages.
- `npm run lint:ci-gates` passed.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.

## Remaining Acceptance Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.
