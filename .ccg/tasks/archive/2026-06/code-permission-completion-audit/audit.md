# Code Completion Audit

## Verdict

Code-related macOS permission UX work is complete for the current scope.

This verdict excludes the user-deferred manual/runtime/release evidence: clean-user Full Disk Access acceptance, certificate provisioning, notarization/signing proof, packaged app proof, and release evidence collection.

## Requirement Matrix

| Requirement | Current Code Evidence | Result |
| --- | --- | --- |
| Non-sandbox macOS file-manager model with user-enabled FDA | `src-tauri/Entitlements.plist` declares `com.apple.security.app-sandbox` as `false`; `scripts/validate-macos-permission-model.mjs` rejects missing, duplicate, or enabled sandbox keys. | Covered |
| App must not auto-enable FDA | `src-tauri/src/commands/fs.rs::register_full_disk_access` delegates to `full_disk_access_status()`; startup/settings only call `open_system_settings` and real probe commands. | Covered |
| FDA validity must use real probes, not cached boolean authority | `src/lib/full-disk-access.ts` single-flights checks, uses `full_disk_access_status` / `register_full_disk_access`, and lets `force`/`registration` bypass the short cache; `src/App.tsx` does not read startup completion localStorage as authority. | Covered |
| Startup setup must guide user to System Settings and poll while visible | `src/App.tsx` runs forced registration probe on startup, opens `StartupPermissionPrompt` on denied/unknown, starts visible polling, and closes only when a forced probe returns `granted`. | Covered |
| Settings and permission recovery share a coordinator | `src/components/settings/useSettingsPermissions.ts` uses `useFullDiskAccessPermission`; Settings exposes status, probes, app identity, System Settings, reveal app, forced recheck, and evidence copy through the shared coordinator. | Covered |
| Denied/unknown recovery should be unified, not scattered directory auth prompts | Explorer protected-directory failures are classified by `checkFullDiskAccessPermission({ force: true })`; denied/unknown show one recovery surface in `ExplorerShell`; Settings and startup use the same coordinator. | Covered |
| No denied-state bypass such as Scan Anyway | `src/__tests__/permission-ux.test.ts` guards startup/settings/Explorer/locales against `Scan Anyway`, `Remind Me Later`, `Open Anyway`, and similar bypass identifiers. | Covered |
| Recovery retries captured protected operation once after granted probe | `src/components/explorer/useExplorerDirectoryData.ts` stores one pending protected path, clears it before retry, and treats a retry failure as generic file error; `src/__tests__/explorer-permission-auto-retry.test.tsx` covers both success and failed retry. | Covered |
| Manual retry must forced-probe before re-reading | `retryProtectedPath` calls `checkFullDiskAccessPermission({ force: true })` and returns early unless status is `granted`; tests assert no relist while still denied. | Covered |
| User-facing FDA copy localized and explains stable app identity/install path drift | Startup, Settings, Explorer, operation fallback, and folder-size copy use `src/i18n/locales/*`; copy includes bundle id/path/reveal-app/stable install guidance; `npm run lint:i18n` verifies coverage. | Covered |
| Default FDA probes must be TCC-only | `src-tauri/src/commands/fs.rs::default_full_disk_access_probe_targets` probes only the three TCC paths; Rust tests, evidence validators, and `lint:macos-permissions` guard this. | Covered |
| Core copy/move/rename/trash must not use AppleScript/Finder/System Events, directory auth fallback, or automatic TCC reset | Transfer uses Rust `fs` operations; trash uses `trash::delete`; rename uses `fs::rename`; `scripts/validate-macos-permission-model.mjs` statically rejects forbidden automation/fallback/reset patterns in core paths. | Covered |
| Directory chooser must not become a core permission fallback | Remaining `openDialog({ directory: true })` usage is ordinary user target selection for import/copy/move/settings, not protected-directory recovery, not bookmark persistence, and not an FDA bypass. | Covered |

## Excluded By User

- Clean-user first launch proof.
- User manually enabling FDA and saving acceptance evidence.
- Restart/upgrade retention proof.
- Certificate provisioning, signing identity proof, notarization, packaged app validation, and final release evidence.

## Verification

- `npm test -- full-disk-access permission-ux explorer-permission-auto-retry macos-permission-model-validator operation-permission-error`
  - 5 files / 55 tests passed.
- `npm run lint`
  - TypeScript, ESLint, and macOS permission model validator passed.
- `npm test`
  - 31 files / 329 tests passed.
- `npm run lint:i18n`
  - Passed.
- `git diff --check`
  - Passed.
- `cargo test` from `src-tauri`
  - 129 Rust tests passed.

## Known Non-Scope Finding

- `cargo clippy --all-targets -- -D warnings` was previously run and failed on existing clean `src-tauri/src/remote.rs` constant assertions. `remote.rs` has no permission UX diff and this audit did not change it.
