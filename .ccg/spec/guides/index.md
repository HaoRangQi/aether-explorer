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
- FDA recovery may retry the captured protected local operation exactly once after a forced probe reports `granted`; if that retry still fails, treat it as a normal file error and do not reopen or loop the FDA recovery flow.
- Manual retry from a blocked protected local directory must run a forced FDA probe first; while the probe is still `denied` or `unknown`, do not re-read the protected directory just because the user clicked retry.
- Saved Full Disk Access acceptance JSON from Settings or `window.__aether.permissionEvidence()` must pass `npm run validate:fda-evidence -- /path/to/fda-evidence.json` before it can be used as release evidence.
- macOS permission configuration changes must pass `npm run lint:macos-permissions`; `npm run lint` includes this preflight.
- Packaged release candidates must pass `npm run validate:macos-app:release -- /path/to/Aether\ Explorer.app` before clean-user Full Disk Access acceptance; this requires a stable non-ad-hoc signing identity with TeamIdentifier and code-signing Identifier `com.aether.explorer`, validates bundle id/name/version, `Info.plist` privacy keys, and inspectable entitlements when present, and does not replace FDA evidence.
- Final clean-user Full Disk Access release evidence must also pass `npm run validate:macos-permission-release -- --app /path/to/Aether\ Explorer.app --evidence /path/to/fda-evidence.json`; this read-only gate pairs the signed `.app` and saved FDA evidence and rejects app identity, bundle id, version, or app path drift.
