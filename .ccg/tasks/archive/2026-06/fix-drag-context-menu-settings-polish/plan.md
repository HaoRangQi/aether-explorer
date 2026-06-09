# Plan

## Analysis

- Locate drag/drop event flow and determine why file dragging no longer triggers the expected move/copy workflow.
- Locate explorer context menu rendering and action ownership.
- Locate create-file command/API boundaries for writing clipboard text.
- Locate Full Disk Access settings card layout and default font persistence.

## Implementation

- Add focused tests for:
  - System Default as default font.
  - Timestamp txt filename generation.
  - Context menu source-level placement/action coverage if direct DOM tests are too brittle.
- Fix drag at the canonical owner.
- Add file context menu actions for opening selected file/folder in a new tab/window.
- Add blank-area "Paste as txt" action and clipboard create flow.
- Polish the permission card layout with a cleaner responsive grid.
- Set default font back to System Default and update fallbacks.

## Verification

- `npm test -- src/__tests__/settings.test.ts`
- focused tests for explorer/menu helpers
- `npm test`
- `npm run lint`
- `npm run lint:i18n`
- `npm run lint:readme`
- `npm run lint:ci-gates`
- `npm run build`
- `git diff --check`
