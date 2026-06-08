# Reveal App in Finder Permission Recovery Review

## Scope

Add a Settings permission recovery action that reveals the exact Aether app target in Finder. Gemini was not called.

Reference: `/Users/macos/Downloads/Projects/mole-ui/docs/macos-file-manager-fda-permission-coordinator-spec.zh-CN.md`.

MoleUI Settings expectation covered in this slice:

- Open Full Disk Access Settings.
- Reveal App in Finder.
- Check Again.

## TDD Evidence

TDD Route: strict.

RED:

- Added `src/__tests__/permission-ux.test.ts` coverage requiring:
  - `reveal_app_in_finder` in the permission panel.
  - `settings.permissions.revealAppInFinder` i18n usage.
  - Tauri handler registration.
  - Rust helper `resolve_app_reveal_path`.
- `npm test -- src/__tests__/permission-ux.test.ts` failed as expected before implementation.

GREEN:

- Added `reveal_app_in_finder` diagnostics command.
- Added `resolve_app_reveal_path` helper:
  - packaged app resolves to the `.app` bundle.
  - dev build falls back to the current executable.
- Registered command in `invoke_handler!`.
- Added Settings permission action with Finder icon.
- Switched the permission panel recovery actions to `safeInvoke`.
- Added user-visible error text if Reveal App fails.
- Added i18n keys and i18n coverage entry.
- Updated `docs/SMOKE_TEST.md`.

## External Review

Claude-only review result: No Critical findings.

Disposition:

- "Untracked `src/lib/full-disk-access.ts` was not shown in diff": noted. That shared coordinator file was reviewed in the previous CCG task; this slice did not change it.
- `preflight_file_permissions` semantic change should be clearer: accepted; strengthened the Rust doc comment to state it is deprecated compatibility and no longer returns Desktop/Documents/Downloads probes.
- Restore removable volume / File Provider privacy strings: rejected for this scope. The MoleUI model explicitly says to lock the permission surface and avoid adding extra domains until separately validated.
- Reveal App errors were swallowed: accepted; Settings now displays a localized error line.

## Verification

Passed:

- `npm test -- src/__tests__/permission-ux.test.ts`
- `cargo test --lib resolve_app_reveal_path`
- `npm run lint:ts`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm test`
- `cargo test --lib`
- `npm run build`
- `rustfmt --edition 2021 --check src-tauri/src/commands/diagnostics.rs src-tauri/src/commands/fs.rs src-tauri/src/models.rs`
- `git diff --check`

Runtime smoke:

- `npm run dev` compiled successfully and launched `target/debug/aether-explorer`.
- Observed for about 10 seconds with no new runtime error output.
- Stopped the dev process and confirmed no matching `target/debug/aether-explorer`, Vite port `41873`, or `scripts/dev.mjs` process remained.

## Remaining Evidence Gap

Clean-user FDA verification is still required before claiming the full permission experience is complete:

- App appears in Full Disk Access.
- User enables FDA and probe returns `granted`.
- Quit/restart remains granted without prompting.
- Replacement/upgrade behavior is verified with stable app identity.
- Default probes do not register unrelated privacy domains.
