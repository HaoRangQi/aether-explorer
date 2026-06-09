# Requirements

- Entering a child directory must reset the file list scroll position to the top.
- Back/forward/sidebar navigation must not inherit an unrelated directory's scroll offset.
- Dragging files into Aether must not make source files disappear unexpectedly.
- Dragging local files within Aether must use copy semantics by default; move must require an explicit user action.
- Finder/external drops must remain copy-only.
- Do not change macOS permission entitlements or use Finder/AppleScript/bookmark/TCC reset workarounds.

