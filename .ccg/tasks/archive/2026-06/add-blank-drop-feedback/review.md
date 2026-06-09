# Review

## Scope

- Added feedback for same-directory blank-area drag releases: `messages.dropOnFolderRequired`.
- Kept the diagnostic branch as `dragEnd action=localSameDirectoryIgnored`.
- Added regression coverage that blank-area releases no longer show `messages.sameDirectory` and do show the folder-target guidance.

## Findings

- No Critical findings.
- Info: latest persisted logs showed no backend move task and repeated `pointFolderId=(none)` with `items=(none)`, proving the cursor was released on current-directory blank space rather than a folder row.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts`: passed, 37 tests.
- `npm test`: passed, 31 files / 364 tests.
- `npm run lint`: passed.
- `cargo test`: passed, 131 Rust tests.
- `git diff --check`: passed.
- `npm run clean:release && node_modules/.bin/tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app,dmg`: passed.

## Release Artifacts

- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`
