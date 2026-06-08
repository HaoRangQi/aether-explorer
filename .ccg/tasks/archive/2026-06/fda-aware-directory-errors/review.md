# Review: FDA-Aware Directory Errors

## Scope

- Local protected directory `PermissionDenied` now checks current Full Disk Access status before showing FDA recovery.
- Remote directory failures no longer render macOS System Settings / Full Disk Access recovery actions.
- Legacy `preflight_file_permissions` keeps its old folder-probe contract while new UI uses `full_disk_access_status`.
- FDA frontend coordinator single-flights and caches non-registration probes for 2.5s.

## External Review

Claude-only review was used. Gemini was not called.

### First Claude Review

Critical findings:

- Legacy `preflight_file_permissions` changed API contract.
- FDA probes could be called too frequently by startup polling.
- Hook initialization allegedly invoked Tauri commands before runtime guard.

Resolution:

- Fixed: restored legacy `preflight_file_permissions` folder path contract via `legacy_permission_preflight_paths`.
- Fixed: added `FULL_DISK_ACCESS_CHECK_CACHE_TTL_MS` and kept `inFlightCheck` in `src/lib/full-disk-access.ts`; startup polling interval is now 2.5s.
- Rejected: `useFullDiskAccessPermission` initializes `useSyncExternalStore` and a memoized callback only; it does not call Tauri until guarded effects or user actions call `checkPermissions`.

### Second Claude Review

Finding:

- Review could not verify `src/lib/full-disk-access.ts` because the file was untracked and ordinary `git diff` omitted it.

Resolution:

- Re-ran review with explicit untracked diffs for `src/lib/full-disk-access.ts` and `src/__tests__/permission-ux.test.ts`.

### Third Claude Review

Result:

- No Critical findings.
- No blocking Warning findings.
- Prior missing-file, FDA caching/throttling, function memoization, and remote/local boundary concerns were verified as resolved.

Non-blocking note:

- Startup permission dialog intentionally has no skip/later path. This matches the current FDA-first product decision and existing test coverage.

## Verification

- `npm test -- src/__tests__/app-error.test.ts`
- `npm test -- src/__tests__/permission-ux.test.ts`
- `npm test -- src/__tests__/permission-ux.test.ts src/__tests__/app-error.test.ts`
- `npm run lint:ts`
- `npm run lint:eslint`
- `npm run lint:i18n`
- `npm test`
- `npm run build`
- `cargo test --lib legacy_permission_preflight_paths_keep_folder_contract`
- `cargo test --lib resolve_app_reveal_path_prefers_outermost_app_bundle`
- `cargo test --lib`
- `rustfmt --edition 2021 --check src-tauri/src/commands/diagnostics.rs src-tauri/src/commands/fs.rs src-tauri/src/models.rs`
- `git diff --check`
- `npm run dev` smoke: Vite served on `http://localhost:41873/`, Tauri reached `target/debug/aether-explorer`, no startup errors during observation, stopped cleanly, no matching dev/Tauri processes remained.

## Residual Risk

- Clean-user real FDA verification is still required outside this automated run: app appears in Full Disk Access, manual grant flips probe to `granted`, restart preserves stable identity.
- `src-tauri/src/lib_tests.rs` has pre-existing whole-file rustfmt drift; `cargo test --lib` passes. I did not format the whole file to avoid unrelated churn in this slice.
