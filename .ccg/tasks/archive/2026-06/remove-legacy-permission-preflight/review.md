# Review

## Scope

- Removed `preflight_file_permissions` from the Tauri invoke handler.
- Removed `legacy_permission_preflight_paths()` and `preflight_file_permissions()` from `src-tauri/src/commands/fs.rs`.
- Removed `PermissionPreflightResult` from `src-tauri/src/models.rs`.
- Removed the Rust test that preserved the legacy directory-preflight contract.
- Strengthened `permission-ux.test.ts` to assert the frontend and backend source do not contain `preflight_file_permissions`.
- Updated Rust test-count documentation from 130 to 129 after removing the legacy contract test.

## External Review

- Gemini was not called.
- Claude-only analysis approved the removal, with the compatibility note that stale dev builds would fail if they still invoked the removed command.
- Claude-only review found no Critical, Warning, or Minor issues.

## Verification

- `rg "preflight_file_permissions|legacy_permission_preflight|PermissionPreflightResult" src-tauri/src src .ccg/tasks/remove-legacy-permission-preflight` showed only task requirements and negative source-test assertions.
- `npm test -- permission-ux` passed: 1 file / 16 tests.
- `cargo test --lib full_disk_access -- --nocapture` passed: 3 tests.
- `npm test` passed: 26 files / 240 tests.
- `npm run test:rust` passed: 129 tests.
- `npm run lint:rust` passed.
- `npm run lint:ts` passed.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed: 78 locale keys and 42 SettingsView high-risk usages verified.
- `npm run lint:readme` passed: 23 tracked headings match.
- `git diff --check` passed.

## Residual Risk

- The long-term goal still requires clean-user/VM Full Disk Access acceptance evidence from `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收`.
- This slice removes a legacy command surface; it does not prove real macOS TCC behavior on a clean machine.
