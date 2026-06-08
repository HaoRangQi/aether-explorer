# Improve Permission UX Plan

## Goal

Move Aether Explorer from per-folder permission checks toward a Finder-style Full Disk Access flow: one clear FDA setup/recovery path, real TCC-only probes, and no repeated directory probing in Settings or startup.

## Architecture

- Rust owns FDA truth via `full_disk_access_status`.
- Frontend only renders the status and recovery actions.
- Startup and Settings share the same command.
- Existing file operations keep using real filesystem errors; this plan does not add a broad PermissionCoordinator retry queue.

## Files

- `src-tauri/src/models.rs`
- `src-tauri/src/commands/fs.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/lib_tests.rs`
- `src-tauri/Info.plist`
- `src/components/settings/useSettingsPermissions.ts`
- `src/components/settings/PermissionsDiagnosticsSettings.tsx`
- `src/components/SettingsView.tsx`
- `src/App.tsx`
- `src/i18n/locales/zh.ts`
- `src/i18n/locales/en.ts`
- frontend tests under `src/__tests__/`

## Compatibility Boundary

- Keep the existing `preflight_file_permissions` command available, but stop using Desktop/Documents/Downloads as default probes.
- Do not introduce a directory-picker fallback.
- Do not cache authorization as truth; localStorage can only suppress repeated startup UI after a granted result.

## TDD Route

- Mode: auto
- Decision: strict
- Reason: permission UX changes touch startup flow, settings UI, and macOS TCC behavior.
- Verification: Rust unit tests, frontend source-level wiring tests, TypeScript check, Rust tests, app build.

## Tasks

1. Add Rust FDA probe types and tests.
2. Implement TCC-only probe command and keep legacy preflight compatible.
3. Replace Settings per-directory check hook with FDA status hook.
4. Replace Settings permission panel with one FDA recovery surface.
5. Update startup permission modal copy and completion rules.
6. Trim `Info.plist` to the permission domains actually in v1.
7. Add frontend regression tests for no per-folder permission probing and FDA command wiring.
8. Run verification and non-Gemini review.
