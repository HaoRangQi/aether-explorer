# Requirements

Implement the user's requested code changes:

1. Fix broken file drag behavior.
2. Add file context menu actions under Rename:
   - Open in New Tab
   - Open in New Window
3. Add blank-area context menu action under New File:
   - Paste as txt
   - Read clipboard text and create a `.txt` file in the current directory.
   - Use timestamp filename in `yyyyMMddHHmmss.txt` format.
4. Improve the Full Disk Access settings card layout shown in the second screenshot.
5. Change the default base font to `System Default`.

## Non-Goals

- Do not perform manual acceptance testing.
- Do not call Gemini.
- Do not change macOS permission model semantics.
- Do not stage or commit business source files unless explicitly requested.

## TDD Route

- Mode: auto
- Decision: strict
- Reason: user-visible drag/menu behavior plus settings persistence/default contract.
- Verification: focused tests for owner helpers and settings defaults, then full frontend lint/test/build.
