# Analysis

## MoleUI Baseline

Source: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md`

Relevant requirements:

- Use one manual Full Disk Access setup.
- Do not keep directory-level authorization or preflight paths in the core permission model.
- Verify FDA through real TCC-only probes.
- Avoid extra privacy-domain noise and destructive TCC reset behavior.

## Finding

The frontend had already migrated away from the legacy permission preflight path, but the backend still exposed:

- `commands::fs::preflight_file_permissions` in the Tauri invoke handler.
- `legacy_permission_preflight_paths()` probing Desktop, Documents, Downloads, Mobile Documents, Trash, and Applications.
- `PermissionPreflightResult`, used only by that deprecated command.
- A Rust test preserving the old directory-preflight contract.

This backend command surface no longer served the current UI and preserved exactly the kind of directory-level preflight model the MoleUI baseline says to remove from the core path.

## Decision

Remove the legacy backend command surface entirely:

- keep `full_disk_access_status`,
- keep `register_full_disk_access`,
- remove `preflight_file_permissions`,
- remove the legacy helper/model/test,
- add a source-level assertion that the backend invoke handler no longer registers the legacy command.

No TCC reset, signing/notarization, helper/root/Admin Mode, or extra privacy-domain work was included.
