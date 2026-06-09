# Review

## External Review

Reviewer: Claude via `codeagent-wrapper --backend claude`

Gemini was intentionally not called because the user explicitly said to ignore Gemini until it is configured.

## Findings

### Critical

- None.

### Warning

- Claude noted that the first English copy said "reveal the exact app target" without naming how to do that. This could be ambiguous for users who have not discovered the Settings permission panel yet.
  - Resolution: updated the English locale and ExplorerShell fallback to say `use Settings > Permissions > Reveal Aether in Finder to confirm the exact app target`.

### Info

- Claude also noted the long English fallback in `ExplorerShell.tsx`. It is acceptable because locale keys are required by tests and lint; the fallback remains English and behavior-neutral.
- The copy does not imply Aether can grant FDA automatically. It still directs users to System Settings and the exact app target.

## Verification

- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/explorer-permission-auto-retry.test.tsx` passed: 2 files, 25 tests.
- `npm test` passed: 31 files, 292 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission model validation.
- `npm run lint:i18n` passed: 77 locale keys, 24 ExplorerView usages, 3 Full Disk Access recovery usages, 12 AIRenamePanel usages, 4 app diagnostics usages, 7 settings diagnostics usages, 15 settings backup usages, 42 SettingsView high-risk usages, and 10 shortcut help usages.
- `npm run lint:readme` passed.
- `npm run lint:ci-gates` passed.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.

## Remaining Acceptance Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.
