# Review: debug-drag-release-target

## Scope

- Investigated the user's report that same-window drag still produced no visible move.
- Read the persisted drag log from `~/Library/Logs/Aether Explorer/drag-debug.log`.
- Confirmed the new formal build was emitting `pointHit` and `pointTargetDir` diagnostics.
- Adjusted same-directory drag-end fallback to close locally with feedback instead of silently falling through to cross-window fallback.

## Finding

The formal build did trigger drag release events:

- `dragEnd enter`
- `dragEnd resolved`

The latest release coordinates resolved to:

- `pointFolderId=(none)`
- `pointTargetDir=/Users/macos/Downloads/tmp/.../新建文件夹 2`
- `pointHit=...data-id=.../新建文件_2_2.txt`
- `items=新建文件_2_2.txt:text`

The source paths were also inside `.../新建文件夹 2`, so the previous code correctly skipped same-directory movement, but the UX was silent.

## Change

- `dragEnd` same-directory fallback now:
  - marks the local drop handled.
  - logs `dragEnd action=localSameDirectory`.
  - shows `messages.sameDirectory`.
  - finishes the shared drag state without emitting cross-window `dragEndAt`.

## Verification

- `npm test -- src/__tests__/explorer-view-utils.test.ts` passed: 35 tests.
- `npm run lint` passed.
- `npm test` passed: 31 files, 362 tests.
- `npm run build` passed with the existing Vite `url-guard.ts` dynamic/static import warning.
- `git diff --check` passed.
- Formal Tauri package succeeded:
  - `src-tauri/target/release/bundle/macos/Aether Explorer.app`
  - `src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`

## Notes

- Gemini was not called.
- The evidence does not show a missing mouseup/dragEnd. It shows a local same-directory release over a regular text file row.

