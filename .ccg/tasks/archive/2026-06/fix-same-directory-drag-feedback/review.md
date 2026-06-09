# Review

## Scope

- Updated drag-end fallback so releases over a non-folder item in the same directory no longer report `messages.sameDirectory`.
- Added a dedicated `dragEnd action=localSameDirectoryNonFolderHit` diagnostic branch.
- Added localized feedback for non-folder drop targets.
- Added regression coverage in `src/__tests__/explorer-view-utils.test.ts`.

## Findings

- No Critical findings.
- Warning: this does not force a move when the cursor is over a normal file row; it prevents the misleading same-directory success message and records the precise branch for follow-up evidence.
- Info: the prior logs showed `pointFolderId=(none)` with `pointHit` resolving to `type=text` rows or current-directory blank surfaces, so no backend move task was started.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts`: passed, 37 tests.
- `npm test`: passed, 31 files / 364 tests.
- `npm run lint`: passed, including TypeScript, ESLint, and macOS permission validation.
- `cargo test`: passed, 131 Rust tests.
- `git diff --check`: passed.
- `npm run build`: passed; existing Vite `url-guard.ts` dynamic/static import warning remains.
- `npm run clean:release && node_modules/.bin/tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app,dmg`: passed.

## Release Artifacts

- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`
