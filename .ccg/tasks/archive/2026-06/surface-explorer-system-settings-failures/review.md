# Review

Gemini was intentionally not called because the active user constraint forbids Gemini usage. Manual acceptance, clean-user evidence collection, and certificate provisioning were left out of scope.

## Read-Only CCG Review

Initial review agent: `/root/review_explorer_system_settings_failures`

Result:

- Critical: None.
- Warning: `dialogs.openSystemSettingsFailed` existed in both locales, but `scripts/check-i18n-coverage.mjs` only checked the bare key name globally. Because `settings.permissions.openSystemSettingsFailed` also exists, deleting the `dialogs` key could still pass locale coverage.
- Info: `ExplorerShell.tsx` now awaits `safeInvoke('open_system_settings')`, catches failures, normalizes via `normalizeAppError(err).userMessage`, and renders `t('dialogs.openSystemSettingsFailed', { error })`.
- Info: The open-settings button remains scoped to local permission errors with `!isRemoteRoot && directoryErrorKind === 'permission'`.

Action:

- Added `requiredDialogKeys = ['openSystemSettingsFailed']` in `scripts/check-i18n-coverage.mjs`.
- The i18n gate now checks the `dialogs` block specifically, so `settings.permissions.openSystemSettingsFailed` cannot mask a missing Explorer recovery key.

Final review agent: `/root/review_explorer_system_settings_failures_final`

Result:

- Critical: None.
- Warning: None.
- Info: Explorer `open_system_settings` failures use `normalizeAppError(err).userMessage` and show the `dialogs.openSystemSettingsFailed` localized error.
- Info: `dialogs.openSystemSettingsFailed` has a dedicated block-level locale check.
- Info: No FDA flow, probe, retry, or permission-model drift found.

## Verification

Fresh verification from the root agent:

- `npm test -- permission-ux full-disk-access` passed: 2 files, 32 tests.
- `npm run lint:i18n` passed: 79 locale keys and 25 ExplorerView usages verified.
- `npm run lint:ts` passed.
- `npm run lint` passed: TypeScript, ESLint, and macOS permission model validation.
- `npm test` passed: 31 files, 322 tests.
- `git diff --check` passed.

## Result

Approved. The main Explorer FDA recovery surface no longer silently swallows System Settings launch failures, and the locale gate now protects the exact Explorer dialog key.
