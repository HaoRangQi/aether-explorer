# Review: add-drag-drop-diagnostics

## Scope

- Added durable drag/drop logs to `~/Library/Logs/Aether Explorer/drag-debug.log` with rotation.
- Instrumented same-window drag/drop, payload reads, move/copy task starts, and transfer settlement.
- Diagnosed user drag attempts from the persisted log.
- Fixed same-window native drag-end fallback when HTML `drop` is not delivered:
  - drag-end hit testing now checks the element stack plus file item bounds.
  - explorer surfaces and column panes expose `data-drop-target-dir`.
  - dropping on a directory blank area now moves into that directory when the source parent differs.
  - dropping back into the source parent logs a same-dir skip instead of starting a task.

## Log Finding

The user-provided repeated drag attempts all showed successful payload setup:

- `writeDragPayload`
- `dragStart`
- `setFileDragPayload ok`
- `emitDragStart ok`

They did not show `dragOver`, `drop`, `movePayload...`, or `transferWait...`.
Every failed attempt ended with `dragEnd resolved ... pointFolderId=(none) localDropHandled=no`.

Root cause: the same-window move never reached the backend because the frontend did not identify a drop target when WebView/native drag suppressed HTML drop events.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 35 tests.
- `npm test` passed: 31 files, 362 tests.
- `npm run lint` passed, including TypeScript, ESLint, and macOS permission validation.
- `npm run build` passed with the existing Vite `url-guard.ts` dynamic/static import warning.
- `cd src-tauri && cargo test drag_debug_log` passed: 2 tests.
- `git diff --check` passed.
- `cd src-tauri && rustfmt --edition 2021 --check src/commands/window.rs` passed.
- Formal Tauri package succeeded:
  - `src-tauri/target/release/bundle/macos/Aether Explorer.app`
  - `src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`

## Review Notes

- Gemini was not called because the user forbade it.
- A read-only explorer agent independently confirmed the same root cause: `dragStart` succeeds, but same-window drop handling skips movement when drag-end hit testing cannot resolve a folder target.
- The ccg-review agent returned no usable report; verification above was run locally.

