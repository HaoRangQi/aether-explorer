# Requirements

Code-only continuation for the macOS permission UX goal. The user explicitly said not to handle manual acceptance work; this slice only hardens FDA evidence validator code.

## Scope

Reject impossible FDA probe state combinations in both saved evidence validation and frontend smoke/acceptance validation, aligned with `src-tauri/src/commands/fs.rs::probe_full_disk_access_target`:

- `readable: true` implies `exists: true`.
- `readable: true` implies `error` is `null` or omitted.
- `exists: false` implies `error` is `null` or omitted.
- Not-found probes are represented as `exists: false`, `readable: false`, no error.
- Permission or read errors are represented as `exists: true`, `readable: false`, with an error string.

## Constraints

- Do not call Gemini for this goal.
- Do not expand into manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve the existing FDA-first, non-sandbox permission model from `.ccg/spec/guides/index.md`.
- Do not stage or commit source changes; only CCG task metadata is archived and committed.
