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
