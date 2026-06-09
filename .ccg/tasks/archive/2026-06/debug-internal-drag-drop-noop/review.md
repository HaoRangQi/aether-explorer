# Review: debug-internal-drag-drop-noop

## Root Cause

- The drag/drop entry gate in `useExplorerDragDrop` only accepted drops when `DataTransfer.types` contained `Files` or Aether's custom MIME, or when React state `isAppFileDragActive` had already updated.
- In the same-window native drag path, the synchronous source of truth is `activeTransferRef`, not `DataTransfer.types` or a later React render.
- When WebView hid custom data-transfer types, `dragover` returned before `preventDefault()`, so the browser never delivered a useful `drop`. That matches the user-visible "dragging in does nothing" behavior.
- A second gap existed for surface drops: even when local drag state existed, unavailable custom payload data could leave `handleSurfaceDrop` with no paths and no action.

## Fix

- `isFileTransferDrag` now accepts active local internal drag state directly.
- `readTransferPayload` falls back to `activeTransferRef.current.paths` when custom data and shared Tauri drag payload are unavailable.
- Added regression tests for:
  - local native drags with hidden/empty `DataTransfer.types` still calling `preventDefault()` and showing a `move` drop.
  - local surface drops moving from active transfer state when payload data is unavailable.

## Findings

### Critical

- None found in local review after the fix.

### Warning

- Claude-only CCG external review was attempted and failed with wrapper exit status 1 before producing review content.
- Gemini was not called because the user explicitly forbade Gemini usage.

### Info

- The fix is frontend-only and does not change macOS permission policy or backend copy/move implementation.
- Cross-window and external drops still copy because local active drag state is absent for those paths and external `Files` drops are handled before stored/internal payload fallback.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 1 file, 32 tests.
- `npm test` passed: 31 files, 359 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission-model validation.
- `npm run build` passed with the existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
- `git diff --check` passed.
- Formal package build passed:
  - `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
  - `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`
- The packaged `.app` was launched from the release bundle path.

## Spec Evolution

- No `.ccg/spec` update needed. This is a platform-event robustness fix for existing drag/drop semantics, not a new project convention.
