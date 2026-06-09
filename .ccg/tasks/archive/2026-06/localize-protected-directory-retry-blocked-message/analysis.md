# Analysis

## Finding

`src/components/explorer/useExplorerDirectoryData.ts` still set a blocked protected-directory `loadError` with a hardcoded Chinese string:

`PermissionDenied: 当前会话中已拦截重复权限请求，请先在系统设置确认授权后重试。`

That message appears in the Explorer error panel detail area and bypasses the existing i18n structure used by the surrounding title, description, action buttons, and recovery steps. It would leak Chinese text in English UI and make future permission copy harder to review.

## Implementation

- Added `dialogs.permissionRetryBlockedDetail` to both locale files.
- Replaced the hardcoded string with `t('dialogs.permissionRetryBlockedDetail', { defaultValue: ... })`.
- Added the key and usage to `scripts/check-i18n-coverage.mjs`.
- Added `permission-ux.test.ts` guardrails to ensure the shared hook uses the localized key and the old Chinese literal does not return.
- Updated documentation counts for Vitest and i18n coverage.
- Added a CCG spec rule: user-facing FDA recovery copy must be localized and covered by `lint:i18n`.

## Remaining External Gap

The broader goal still requires clean-user FDA release evidence from `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收`.

