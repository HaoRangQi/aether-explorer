# Frontend Spec

## Explorer Drag And Drop

- Same-window file moves must not rely only on React `onDrop`; Tauri/WebView native drag can deliver `dragEnd` without `dragOver` or `drop`.
- Keep a drag-end fallback that resolves the release point from the element stack, file item bounds, and `[data-drop-target-dir]` surfaces before deciding that no local target exists.
- When adding explorer panes that accept blank-area drops, mark the pane with `data-drop-target-dir` so drag-end fallback can resolve the target directory.
- Persistent drag diagnostics should include payload source, release coordinates, resolved folder id, resolved target directory, point hit summary, action branch, and transfer task settlement.

