# Plan

## Implementation

- Add frontend API wrappers for reading clipboard text and checking whether clipboard text exists.
- Add Tauri commands backed by macOS `pbpaste` for text clipboard reads.
- Replace paste-as-txt `navigator.clipboard.readText()` usage with the Tauri API.
- Track `hasTextClipboard` in `ExplorerView` and pass it through custom and native context menus.
- Disable paste-as-txt when no clipboard text is available.

## Verification

- Focused source tests for command/API/menu wiring.
- `npm test -- src/__tests__/explorer-view-utils.test.ts`
- `npm run lint`
- `npm run lint:i18n`
- `npm run test:rust`
- `npm run build`
