# Runtime Verification Review

## Scope

Continuation task for the Aether Explorer macOS permission UX work. Gemini was not used for this review; the external review was Claude-only.

Reference checked: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md`.

Key reference constraints:
- Use a non-sandboxed file-manager model with one manual Full Disk Access setup.
- Verify authorization with real probes instead of cached booleans.
- Do not fall back to repeated per-directory authorization for the core file-manager path.
- Do not claim the permission experience is closed without clean-user FDA evidence.

## Changes Verified In This Continuation

- Added dev smoke coverage for `full_disk_access_status` so command registration and serialized `status/probes` shape are checked from the Tauri runtime.
- Updated `docs/SMOKE_TEST.md` with Full Disk Access-specific smoke steps:
  - Settings shows one FDA state, not Desktop/Documents/Downloads statuses.
  - System Settings recovery points users to Privacy & Security > Full Disk Access.
  - Check Again uses `full_disk_access_status`.
  - Probe evidence must remain TCC-only.
- Updated `docs/TEST_PLAN.md` to include `full_disk_access_status` in console smoke coverage.
- Replaced stale visible i18n wording about "folder access status" with Full Disk Access wording.
- Added a compatibility comment documenting that `preflight_file_permissions` now adapts FDA probe evidence for older callers.

## External Review

Claude reviewer output: No Critical findings.

Reviewer Major findings and disposition:
- `preflight_file_permissions` name is semantically legacy now that it returns TCC-only probe evidence. Disposition: accepted as compatibility risk; added an explicit Rust comment telling new UI to call `full_disk_access_status`.
- Startup permission prompt does not mark denied/unknown as done. Disposition: intentional for the current "no skip/later path" model from the CCG implementation. The prompt should remain until FDA is granted; this is not a hidden cache success state.
- Settings auto-check can run more than once in React StrictMode. Disposition: accepted low risk; TCC probe is read-only and no destructive prompt/reset is performed.
- Smoke should validate probe object shape. Disposition: fixed.

## Verification Commands

Passed after the final edits:

- `npm run lint:i18n`
- `npm test -- src/__tests__/permission-ux.test.ts`
- `cargo test --lib full_disk_access`
- `npm run lint:ts`
- `npm run lint:eslint`
- `npm test`
- `cargo test --lib`
- `npm run build`
- `rustfmt --edition 2021 --check src-tauri/src/commands/fs.rs src-tauri/src/models.rs`
- `git diff --check`

Tauri runtime smoke:

- `npm run dev` compiled successfully and launched `target/debug/aether-explorer`.
- Observed the running dev process for about 10 seconds with no new runtime error output.
- Stopped the dev process and confirmed no matching `target/debug/aether-explorer`, Vite port `41873`, or `scripts/dev.mjs` process remained.

Formatting note:

- `rustfmt --edition 2021 --check src-tauri/src/lib_tests.rs` still wants to reindent most of the existing test file. This was not accepted because it would create broad unrelated formatting churn. The Rust implementation files touched by the FDA command path pass rustfmt.

## Remaining Evidence Gap

MoleUI's reference requires clean-user or clean-machine evidence before claiming the FDA experience is fully closed:

- App appears in Full Disk Access.
- User manually enables FDA and the app probe returns `granted`.
- Quit/restart does not ask again.
- Replacement/upgrade preserves FDA when the stable app identity is unchanged.
- Default probes do not register unrelated privacy domains.

Those clean-machine TCC checks were not performed in this continuation. No `tccutil reset` was run.

## Verdict

Code, docs, tests, and local Tauri runtime compilation/startup evidence are strong enough for implementation handoff. Full product-level "permission experience closed" remains unproven until clean-user FDA verification is performed.
