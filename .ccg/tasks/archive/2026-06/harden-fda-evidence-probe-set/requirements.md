# Requirements

The user clarified this slice should only cover code-related changes and should not expand into manual acceptance, certificate provisioning, or clean-user evidence collection work.

## Scope

Tighten FDA evidence validators so saved evidence and frontend evidence collection only accept the actual Rust default Full Disk Access probe path/type pairs:

1. `/Library/Application Support/com.apple.TCC/TCC.db` as `file`
2. `/Users/<name>/Library/Application Support/com.apple.TCC` as `directory`
3. `/Users/<name>/Library/Application Support/com.apple.TCC/TCC.db` as `file`

Reject:

- `/Library/Application Support/com.apple.TCC` system directory, because Rust does not probe it.
- TCC path/targetType mismatches.
- Any user-content or arbitrary nested TCC path.

## Constraints

- Do not call Gemini.
- Do not handle manual acceptance or clean-user evidence collection in this slice.
- Keep the source-of-truth aligned with `src-tauri/src/commands/fs.rs::default_full_disk_access_probe_targets`.
