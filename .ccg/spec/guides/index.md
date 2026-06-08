# Guides Spec

## macOS Permission Model

- Aether's core macOS file-manager permission model is non-sandbox + user-enabled Full Disk Access.
- Keep `com.apple.security.app-sandbox` set to `false`.
- Do not add sandbox directory authorization entitlements to the core path:
  - `com.apple.security.files.user-selected.read-write`
  - `com.apple.security.files.downloads.read-write`
  - `com.apple.security.files.bookmarks.app-scope`
- Do not add Apple Events entitlement or `NSAppleEventsUsageDescription` unless a future task explicitly designs a separate, optional Apple Events feature and its recovery UX.
- Keep default Full Disk Access probes limited to TCC paths; do not probe Mail, Safari, Messages, Contacts, Calendars, Photos, Reminders, Desktop, Documents, Downloads, or application data directories for FDA status.
- Saved Full Disk Access acceptance JSON from Settings or `window.__aether.permissionEvidence()` must pass `npm run validate:fda-evidence -- /path/to/fda-evidence.json` before it can be used as release evidence.
- macOS permission configuration changes must pass `npm run lint:macos-permissions`; `npm run lint` includes this preflight.
- Packaged release candidates must pass `npm run validate:macos-app -- /path/to/Aether\ Explorer.app` before clean-user Full Disk Access acceptance; this validates bundle id/name/version, `Info.plist` privacy keys, and inspectable entitlements only, and does not replace FDA evidence.
