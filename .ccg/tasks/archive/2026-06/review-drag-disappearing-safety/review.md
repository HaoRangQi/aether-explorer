# Review

## Findings

### Critical

- None found in the current internal drag path.

### Warning

- The earlier symptom is consistent with the old internal drag implementation invoking move operations by default. Current code no longer wires internal Aether drag/drop to move handlers.
- The user-visible "target not showing the file" could also have been amplified by the old scroll inheritance bug when entering the target folder, because the list could open far below the top.

### Info

- Gemini was not called per user instruction.
- Two local `ccg-review` agents were dispatched for front-end flow and backend transfer review, but both completed without returning usable report bodies. Manual review and tests were used for evidence.
- Added stronger front-end regression coverage:
  - Internal payload drop into a folder must call `copyPayloadPathsToFolder`.
  - Native `dragEnd` fallback over a folder must call `copyDraggedFiles`.

## Evidence

- Front-end internal drag payloads are written as copy:
  - `setFileDragPayload(paths, false, ...)`
  - HTML payload `{ paths, cut: false }`
  - `effectAllowed = "copy"`
  - folder/blank drop hover uses `dropEffect = "copy"`
- Internal drag operation call sites currently use copy handlers:
  - mouse-up folder drop -> `copyDraggedFilesRef.current`
  - native `dragEnd` fallback -> `copyDraggedFilesRef.current`
  - internal payload surface drop -> `copyPayloadPathsToDirectory`
  - internal payload folder drop -> `copyPayloadPathsToFolder`
- Backend copy task path (`copy_files_impl` / `start_copy_files_task`) copies to staged temporary targets and commits them to the destination. It removes temporary targets on failure/cancel but does not remove source paths.
- Remaining move operations are still present for explicit move flows:
  - cross-window Shift/default move setting
  - conflict dialog move resolution
  - explicit move/cut operations

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 25 tests.
- `cargo test --lib copy_files` passed: 3 tests.
- `npm run lint` passed.
- `npm test` passed: 31 test files, 352 tests.
- `npm run build` passed.
- `git diff --check` passed.

## Conclusion

The current code is materially safer than the old implementation for internal Aether dragging: internal drag no longer moves by default and no reviewed current internal drag branch deletes source files. If the packaged app still shows source disappearance after this patch is installed, the next diagnostic target should be runtime logs/transfer task snapshots for the exact source path, target path, task id, and operation kind.
