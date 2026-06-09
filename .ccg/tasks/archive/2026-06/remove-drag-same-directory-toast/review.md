# Review

## Scope

- Removed the drag-end fallback toast that showed `messages.sameDirectory` when files were released over the current directory blank area.
- Renamed the diagnostic branch to `dragEnd action=localSameDirectoryIgnored`.
- Updated regression coverage so same-directory drag release does not call `showFeedback('已在该目录中')`.

## Findings

- No Critical findings.
- Info: latest logs showed `pointTargetDir` equal to the dragged file parent directory with `items=(none)`, meaning the cursor released on current-folder blank space. The old toast was technically true but misleading for this workflow.

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
