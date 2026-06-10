# Guides Spec

## macOS Permission Model

- Aether's core macOS file-manager permission model is non-sandbox + user-enabled Full Disk Access.
- Keep `com.apple.security.app-sandbox` set to `false`.
- Do not add sandbox directory authorization entitlements to the core path:
  - `com.apple.security.files.user-selected.read-write`
  - `com.apple.security.files.downloads.read-write`
  - `com.apple.security.files.bookmarks.app-scope`
- Do not add Apple Events entitlement or `NSAppleEventsUsageDescription` unless a future task explicitly designs a separate, optional Apple Events feature and its recovery UX.
- Core copy/move/rename/trash operations must not route through AppleScript/Finder/System Events, `NSOpenPanel`, security-scoped bookmarks, or automatic `tccutil reset`; keep `npm run lint:macos-permissions` guarding these anti-patterns.
- Keep default Full Disk Access probes limited to TCC paths; do not probe Mail, Safari, Messages, Contacts, Calendars, Photos, Reminders, Desktop, Documents, Downloads, or application data directories for FDA status.
- FDA recovery may retry the captured protected local operation exactly once after a forced probe reports `granted`; if that retry still fails, treat it as a normal file error and do not reopen or loop the FDA recovery flow.
- Manual retry from a blocked protected local directory must run a forced FDA probe first; while the probe is still `denied` or `unknown`, do not re-read the protected directory just because the user clicked retry.
- User-facing Full Disk Access recovery copy must be localized through `src/i18n/locales/*` and covered by `npm run lint:i18n`; do not hardcode one locale inside shared permission hooks or libraries.
- Explorer Full Disk Access recovery copy must explain both macOS privacy protection and stable app identity/install-path drift; avoid generic "permission denied" copy that leaves users guessing why access keeps failing.
- Saved Full Disk Access acceptance JSON from Settings or `window.__aether.permissionEvidence()` must pass `npm run validate:fda-evidence -- /path/to/fda-evidence.json` before it can be used as release evidence.
- macOS permission configuration changes must pass `npm run lint:macos-permissions`; `npm run lint` includes this preflight.
- Packaged release candidates must pass `npm run validate:macos-app:release -- /path/to/Aether\ Explorer.app` before clean-user Full Disk Access acceptance; this requires a stable non-ad-hoc signing identity with TeamIdentifier and code-signing Identifier `com.aether.explorer`, validates bundle id/name/version, `Info.plist` privacy keys, and inspectable entitlements when present, and does not replace FDA evidence.
- Final clean-user Full Disk Access release evidence must also pass `npm run validate:macos-permission-release -- --app /path/to/Aether\ Explorer.app --evidence /path/to/fda-evidence.json`; this read-only gate pairs the signed `.app` and saved FDA evidence and rejects app identity, bundle id, version, or app path drift.

## Release Workflow

- GitHub Release completion follows `codex/06-release-runbook.md`: versioned release assets, updater `.app.tar.gz.sig`, `latest.json`, `SHA256SUMS`, and `stable/latest.json` must all validate before a release is complete.
- Formal macOS releases that are expected to preserve Full Disk Access must require Apple app code signing inputs in the automated release workflow: `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`. These are distinct from `TAURI_SIGNING_PRIVATE_KEY`, which only signs updater artifacts.
- Do not promote manual Full Disk Access acceptance into automated release workflow prerequisites. Manual acceptance remains evidence, not a CI secret or automated action.
- SSH/SFTP native dependencies must keep `ssh2` on `vendored-openssl`; universal macOS release builds run on ARM runners and must not depend on pkg-config discovering x86_64 Homebrew OpenSSL.
- Ad-hoc single-DMG releases must use a `vX.Y.Z-adhoc.N` prerelease tag, build with Tauri `macOS.signingIdentity="-"` so the app bundle has a complete ad-hoc `_CodeSignature`, upload only the local DMG, skip `stable/latest.json`, and state that Full Disk Access may need reauthorization because the app is not Developer ID-signed.
