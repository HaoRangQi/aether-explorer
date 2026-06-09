# Review: fix-same-window-drag-move-refresh

## Scope

- Restored same-window internal file drag/drop to move semantics.
- Kept cross-window Aether payload drops and external Finder drops on copy semantics.
- Added move-settlement refresh for the target directory and every moved source parent directory.
- Added regression coverage for drag state cleanup, repeated drags, move/copy routing, and move refresh paths.

## Findings

### Critical

- None found in local source review or automated verification.

### Warning

- External Claude-only CCG review was attempted previously and failed with wrapper exit status 1 before producing review content.
- Gemini was intentionally not called because the user explicitly forbade Gemini usage for this work.

### Info

- `src/components/explorer/useExplorerDragDrop.ts` now treats a payload as a move only when it is both marked `cut` and there is active local drag state. Cross-window payloads without local drag state copy even if the payload carries `cut`.
- `src/components/ExplorerView.tsx` refreshes `targetFolder.path` and source parent directories after transfer-task moves settle.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 1 file, 30 tests.
- `npm test` passed: 31 files, 357 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission-model validation.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.
- Formal package build passed:
  - `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
  - `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`

## Spec Evolution

- No `.ccg/spec` update needed. This task restored existing drag/drop behavior and did not add a new durable project convention.
