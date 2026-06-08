# Startup Full Disk Access Polling Requirements

## Objective

Improve the startup Full Disk Access setup flow by polling real FDA status while the setup modal is visible, so users do not have to guess when to click Check Again after toggling System Settings.

## Reference

`/Users/macos/Downloads/Projects/mole-ui/docs/macos-file-manager-fda-permission-coordinator-spec.zh-CN.md`

## Requirements

- Poll only while the startup FDA setup UI is visible.
- Poll with real `full_disk_access_status` via the shared frontend coordinator.
- Do not use cached localStorage as authorization truth.
- Stop the polling timer when the UI closes, unmounts, or FDA becomes granted.
- Keep the manual check button.
- Do not add background permanent polling, directory authorization, `tccutil reset`, Apple Events, Gemini calls, or retry queues.

## Evidence Needed

- RED test fails before implementation and passes after implementation.
- TypeScript, ESLint, i18n, permission UX tests, build, and relevant Rust checks pass.
- Tauri dev compiles/launches without runtime errors.
- Claude-only review is recorded.
