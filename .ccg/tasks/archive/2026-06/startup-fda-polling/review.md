# Startup FDA Polling Review

## Scope

Add automatic Full Disk Access polling while the startup permission setup modal is visible. Gemini was not called.

Reference: `/Users/macos/Downloads/Projects/mole-ui/docs/macos-file-manager-fda-permission-coordinator-spec.zh-CN.md`.

Reference rules covered:

- Poll only while setup/recovery UI is visible.
- Poll with real FDA probe, not cached booleans.
- Stop timer when UI closes, user is granted, or component unmounts.
- Do not create permanent background polling.

## TDD Evidence

TDD Route: strict.

RED:

- Added `src/__tests__/permission-ux.test.ts` coverage requiring:
  - `STARTUP_FULL_DISK_ACCESS_POLL_INTERVAL_MS`
  - `window.setInterval`
  - `window.clearInterval`
  - ordinary `checkFullDiskAccessPermissions()` polling while `startupPermissionPromptOpen`
  - user-facing `appPermissions.autoCheckHint`
- `npm test -- src/__tests__/permission-ux.test.ts` failed as expected before implementation.

GREEN:

- Added `STARTUP_FULL_DISK_ACCESS_POLL_INTERVAL_MS = 1_000`.
- Added a Tauri-gated effect that starts polling only when `startupPermissionPromptOpen` is true.
- Polling uses shared coordinator `checkFullDiskAccessPermissions()` so it hits the FDA status command and shares in-flight work.
- On `granted`, polling calls `markStartupPermissionPromptDone()`, which closes the modal and removes the startup lock.
- Cleanup clears the interval and ignores any in-flight result after unmount/close.
- Added startup copy explaining that Aether keeps checking while the setup window is open.
- Updated `docs/SMOKE_TEST.md`.

## External Review

Claude-only review result: No Critical findings.

Disposition:

- Polling interval not "canceling" an in-flight async call after close: accepted as safe; added comment explaining `clearInterval` prevents future probes and `cancelled` ignores settled results.
- Multi-window startup races: accepted as safe; added comment explaining localStorage reduces duplicate setup UI and the shared coordinator single-flights backend probes.

## Verification

Passed before Claude review:

- `npm test -- src/__tests__/permission-ux.test.ts`
- `npm run lint:ts`
- `npm run lint:i18n`
- `npm run lint:eslint`
- `npm test`
- `cargo test --lib full_disk_access`
- `npm run build`
- `rustfmt --edition 2021 --check src-tauri/src/commands/diagnostics.rs src-tauri/src/commands/fs.rs src-tauri/src/models.rs`
- `git diff --check`

Runtime smoke:

- `npm run dev` compiled successfully and launched `target/debug/aether-explorer`.
- Observed for about 10 seconds with no new runtime error output.
- Stopped the dev process and confirmed no matching `target/debug/aether-explorer`, Vite port `41873`, or `scripts/dev.mjs` process remained.

Passed after final comment edits:

- `npm run lint:ts`
- `npm test -- src/__tests__/permission-ux.test.ts`
- `git diff --check`

## Remaining Evidence Gap

Clean-user FDA verification is still required before claiming the full permission experience is complete:

- App appears in Full Disk Access.
- User enables FDA and probe returns `granted`.
- Startup modal auto-poll closes after FDA is granted.
- Quit/restart remains granted without prompting.
- Replacement/upgrade behavior is verified with stable app identity.
- Default probes do not register unrelated privacy domains.
