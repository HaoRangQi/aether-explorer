# Analysis

## Baseline

Reference: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` and linked FDA implementation / clean-machine verification docs.

The relevant baseline for Aether:

- Non-sandbox macOS file manager.
- User manually enables Full Disk Access once in System Settings.
- Every startup / recovery uses real TCC-only probes; no cached boolean is the source of truth.
- Core path must not use directory-level `NSOpenPanel`, security-scoped bookmarks, or sandbox file entitlements.
- FDA recovery is unified; feature flows should not each invent a separate permission prompt.
- Default probes must avoid Mail/Safari/Messages/Contacts/Calendars/Photos privacy noise.
- Clean macOS user / VM / test machine evidence is required before claiming the permission model is closed.

## Current Aether Evidence

- FDA commands are registered: `full_disk_access_status`, `register_full_disk_access`, `get_app_identity`, `reveal_app_in_finder`.
- FDA probes are TCC-only:
  - `/Library/Application Support/com.apple.TCC/TCC.db`
  - `~/Library/Application Support/com.apple.TCC`
  - `~/Library/Application Support/com.apple.TCC/TCC.db`
- Startup and Settings use the shared frontend FDA coordinator.
- Settings shows app identity, reveal-current-app action, fresh recheck, probe evidence, and copyable FDA acceptance evidence.
- Local protected `PermissionDenied` routes through fresh FDA classification.
- Remote permission errors stay on the remote recovery surface and do not show macOS FDA recovery.
- Legacy directory preflight and protected-path consent state have already been removed.
- `docs/SMOKE_TEST.md` defines the required `0.1 Full Disk Access 干净用户验收`.

## Gap Found And Fixed

`src-tauri/Entitlements.plist` still declared sandbox-style directory file entitlements:

- `com.apple.security.files.user-selected.read-write`
- `com.apple.security.files.downloads.read-write`

Those conflict with the MoleUI baseline because the v1 core permission model is non-sandbox + one FDA setup, not user-selected directory authorization. They were removed, leaving only:

- `com.apple.security.app-sandbox = false`

Regression coverage was added to `src/__tests__/permission-ux.test.ts` so these entitlements cannot silently return.

## Accepted Boundary

Claude review raised whether `NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription`, and `NSDownloadsFolderUsageDescription` should remain. The MoleUI implementation guide explicitly recommends keeping those three descriptions as necessary fallback/system explanation text while avoiding unrelated domains such as Apple Events, removable volumes, File Provider, Automation, Accessibility, Mail, Safari, Messages, Contacts, Calendars, Photos, and Reminders.

No change was made to those three Info.plist keys.

## Remaining Completion Evidence

The main permission UX goal is still not complete until `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` is executed on a clean macOS user, VM, or disposable test machine and the copied FDA evidence JSON / screenshots / failure notes are recorded.

Without that real environment evidence, the current state is: permission design and automated verification complete, but FDA UX closure not proven.

## Verification

- `npm test -- permission-ux`: passed, 17 tests
- `npm test`: passed, 26 files / 241 tests
- `npm run lint:ts`: passed
- `npm run lint:eslint`: passed
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
