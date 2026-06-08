# Analysis

## Scope

Remove the legacy Explorer protected-path consent gate that was left behind after the permission UX moved to Full Disk Access recovery.

## Findings

- `.ccg/spec/` has no active spec files for this task.
- `needsProtectedPathConsent` was hard-coded to `false`, so the consent screen was unreachable.
- `approvedProtectedRoots` and `PROTECTED_ROOT_APPROVALS_KEY` only supported the unreachable consent flow.
- `blockedProtectedRoots`, `isProtectedPathBlocked`, and `retryProtectedPath` are still active and must remain because they prevent repeated automatic reads after a protected-path permission failure until the user retries.
- Existing FDA recovery is still gated by local permission errors and `!isRemoteRoot`; remote directory errors keep the remote failure surface.

## Implementation

- Removed protected-root approvals/sessionStorage state and helper code.
- Removed `approveProtectedRoot`, `needsProtectedPathConsent`, and obsolete `protectedRoot` shell prop plumbing.
- Removed the unreachable protected-path consent screen from `ExplorerShell`.
- Removed obsolete i18n keys and i18n coverage requirements:
  - `protectedPathTitle`
  - `protectedPathDescription`
  - `continueAccess`
  - `backHome`
- Added a source-level permission UX regression test proving the old consent path is gone while retry blocking remains wired.

## Verification

- `npm test -- permission-ux`: passed, 17 tests
- `npm run lint:ts`: passed
- `npm run lint:i18n`: passed
- `npm test`: passed, 26 files / 241 tests
- `npm run lint:eslint`: passed
- `npm run lint:readme`: passed
- `git diff --check`: passed
