# Review

## Result

- Drag-end target resolution now uses the drag-start screen/client offset when native WebView `dragend` client coordinates are stale.
- The fallback keeps folder and blank-area drop targets resolvable through element stack checks and `[data-drop-target-dir]`.

## Verification

- `npm test`
- `npm run lint`
- `npm run test:rust`
- `npm run lint:rust`
- `npm run build`
