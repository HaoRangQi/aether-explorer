# Improve Permission UX Requirements

## Reference

Primary reference: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md`

The target experience is:

- Aether Explorer is a non-sandboxed macOS file manager.
- Users manually enable Full Disk Access once in System Settings.
- Aether verifies current authorization with real probes every time it needs a status answer.
- When Full Disk Access is granted, core browsing and file operations should not ask for directory-level authorization repeatedly.
- When authorization is missing or revoked, Aether shows one recovery path instead of scattered per-feature prompts.
- Default probes must avoid Desktop/Documents/Downloads/Mail/Safari/Messages/Contacts/Calendars/Photos and should use TCC-only paths.

## Current Gaps

- `preflight_file_permissions` probes Desktop, Documents, Downloads, iCloud, Trash, and Applications.
- Settings shows per-folder access checks instead of one Full Disk Access status.
- The startup permission modal says macOS will request several folder permissions and offers `Later`, then the flow can mark permission setup as complete without a granted result.
- `Info.plist` declares removable volumes and File Provider usage even though the reference recommends locking those domains out of v1.

## In Scope

- Add a Rust-side Full Disk Access status probe based on TCC-only paths.
- Repoint startup permission flow to the Full Disk Access status model.
- Repoint Settings permission UI to a single FDA setup/recovery surface.
- Keep `open_system_settings` as the single route to Full Disk Access settings.
- Add tests for probe target selection, status summarization, and frontend command wiring.
- Remove extra usage descriptions for permission domains that are not part of the v1 core path.

## Out of Scope

- No security-scoped bookmarks.
- No directory-level NSOpenPanel fallback.
- No admin/root helper.
- No Apple Events or Finder/System Events file-operation fallback.
- No Disk Analyzer or helper-process TCC ownership redesign in this slice.
- No promise that dev builds preserve TCC grants across rebuilds.
