# Requirements

- Paste-as-txt must not rely on `navigator.clipboard.readText()` in the Tauri app.
- Blank-area context menu item "Paste as txt" must be disabled when the system clipboard has no text content.
- The system/native context menu must use the same enabled-state check.
- Do not alter macOS permission entitlements or core file-operation permission model.
