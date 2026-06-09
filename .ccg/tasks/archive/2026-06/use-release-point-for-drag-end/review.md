# Review

## Scope

- Added global drag hover coordinate tracking to update `dragOverFolderId` even when React folder `onDragOver` is not delivered.
- Reused the highlighted folder as the drag-end fallback target when `dragend` coordinates resolve to blank space.
- Added diagnostic logs: `globalDragHover`, `highlightedFolderId`, and `resolvedFolderId`.
- Added regression coverage for stale `dragend` coordinates after a folder hover.

## Findings

- No Critical findings.
- Info: latest persisted logs showed `dragend` coordinates resolving to blank space while subsequent `mouseup` coordinates were over folder text. The fix makes the hover-highlighted folder authoritative for the final fallback.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts`: passed, 38 tests.
- `npm test`: passed, 31 files / 365 tests.
- `npm run lint`: passed.
- `cargo test`: passed, 131 Rust tests.
- `git diff --check`: passed.
- `npm run clean:release && node_modules/.bin/tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app,dmg`: passed.

## Release Artifacts

- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`
