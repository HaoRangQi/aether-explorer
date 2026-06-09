# Requirements

Code-only continuation for the macOS permission UX goal. The user explicitly said not to handle manual acceptance work; this slice only tightens FDA evidence validator code.

## Scope

Require saved FDA evidence and frontend evidence validation to match the complete Rust default Full Disk Access probe set from `src-tauri/src/commands/fs.rs::default_full_disk_access_probe_targets`:

1. exactly one `/Library/Application Support/com.apple.TCC/TCC.db` `file` probe;
2. exactly one `/Users/<name>/Library/Application Support/com.apple.TCC` `directory` probe;
3. exactly one `/Users/<same-name>/Library/Application Support/com.apple.TCC/TCC.db` `file` probe.

Reject:

- partial probe sets;
- duplicate default probes;
- mixed-user user TCC probes;
- extra/non-TCC probes;
- path/type mismatches;
- traversal-shaped user segments such as `/Users/.` and `/Users/..`.

## Constraints

- Do not call Gemini.
- Do not expand into manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve existing FDA-first, non-sandbox permission model.
