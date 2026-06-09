# Plan

## Analysis

- Trace Finder/external Tauri drag-drop handling.
- Trace Aether-to-Aether drag handling and transfer task source deletion rules.
- Identify where operation mode is chosen and where source removal occurs.

## Implementation

- Add focused regression tests before changing behavior.
- Make external drops copy-only unless an explicit move signal is supported and intentional.
- Ensure failed or cancelled copy/move transfer paths do not remove source files.

## Verification

- Focused drag/drop tests.
- `npm test`
- `npm run lint`
- `cd src-tauri && cargo test --lib`
- `npm run build`
- `git diff --check`
