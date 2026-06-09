# Requirements

- Dragging files into Aether must not cause source files to disappear unexpectedly.
- Finder/external drag into Aether should default to copy semantics unless the user explicitly requests move.
- Aether-to-Aether drag must honor the configured default and keyboard modifiers without deleting source files on failed or cancelled transfers.
- Fix must not use Finder, AppleScript, security-scoped bookmarks, directory authorization entitlements, or TCC reset flows.
- Add regression coverage for the data-loss class.

