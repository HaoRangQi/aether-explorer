# Permission Coordinator Foundation Review

## Scope

Add a small frontend foundation for a shared Full Disk Access permission coordinator. Gemini was not called.

Reference: `/Users/macos/Downloads/Projects/mole-ui/docs/macos-file-manager-fda-permission-coordinator-spec.zh-CN.md`.

This slice intentionally stays inside the reference boundary:

- Shared FDA status/check path for startup and Settings.
- One active frontend check through a single-flight promise.
- Real FDA probe on Tauri startup.
- No directory-level authorization fallback.
- No timers, retry queue, scanner rewrite, helper/root flow, Apple Events, or `tccutil reset`.

## Implemented

- Added `src/lib/full-disk-access.ts`.
  - Exposes shared `FullDiskAccessPermissionSnapshot`.
  - Uses `useSyncExternalStore` for React-safe subscription.
  - Uses one `inFlightCheck` promise so startup and Settings do not fire overlapping FDA checks.
  - Supports `{ registration: true }` for the startup/setup path while documenting that this is still only a TCC-gated probe.
- Updated `src/components/settings/useSettingsPermissions.ts`.
  - Settings now delegates to `useFullDiskAccessPermission()` instead of maintaining isolated local permission state.
- Updated `src/App.tsx`.
  - Startup FDA setup uses the shared coordinator.
  - Tauri startup no longer trusts `localStorage` `done` as the authorization source of truth.
  - Startup does a real `register_full_disk_access`/probe and only shows the setup modal when status is `denied` or `unknown`.
  - `localStorage` `done` remains only as a cross-window close signal after a granted probe.
- Updated `src/__tests__/permission-ux.test.ts`.
  - Covers shared coordinator wiring.
  - Covers no cached startup completion as source of truth.
  - Keeps no per-directory probe regression checks.

## External Review

Claude-only review result: No Critical findings.

Claude raised one Major finding: restore `localStorage` `done` check to avoid probing every restart.

Disposition: rejected. MoleUI's reference says authorization validity must be verified with real probes and cached booleans must not represent FDA truth. The current behavior intentionally probes on each Tauri startup and uses localStorage only to coordinate prompt closing after a granted probe.

Minor suggestions:

- Clarify the `registration` option naming. Disposition: addressed with an inline comment.
- Settings auto-check can overlap the startup probe if Settings opens during the launch delay. Disposition: accepted; the coordinator single-flight prevents duplicate backend calls.
- Startup modal has no close affordance. Disposition: intentional for the current no-skip setup flow.

## Verification

Passed:

- `npm run lint:ts`
- `npm test -- src/__tests__/permission-ux.test.ts`
- `npm run lint:i18n`
- `npm run lint:eslint`
- `npm test`
- `cargo test --lib full_disk_access`
- `npm run build`
- `git diff --check`

Runtime smoke:

- `npm run dev` compiled successfully and launched `target/debug/aether-explorer`.
- Observed for about 10 seconds with no new runtime error output.
- Stopped the dev process and confirmed no matching `target/debug/aether-explorer`, Vite port `41873`, or `scripts/dev.mjs` process remained.

## Remaining Evidence Gap

This foundation improves code-side alignment with the MoleUI model, but clean-user FDA evidence is still required before claiming the full permission experience is closed:

- App appears in Full Disk Access.
- User enables FDA and probe returns `granted`.
- Quit/restart remains granted without prompting.
- Replacement/upgrade behavior is verified with stable app identity.
- Default probes do not register unrelated privacy domains.
