# Requirements

- In development runtime only, do not block startup on the Full Disk Access setup modal.
- Production builds must keep the existing Full Disk Access startup probe, polling, app identity display, and recovery behavior.
- Do not change macOS entitlements, TCC probe targets, or core file operation permission semantics.
- Do not route core copy/move/rename/trash through directory picker, bookmarks, AppleScript, or Finder automation.
