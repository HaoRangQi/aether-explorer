# Requirements

Code-only continuation for the macOS permission UX goal. This slice improves the Full Disk Access recovery surfaces when the app cannot open macOS System Settings.

## Scope

- Startup Full Disk Access prompt must show a localized error if `open_system_settings` fails.
- Settings > Privacy & Permissions must show a localized error if `open_system_settings` fails.
- The error should use the existing normalized app error path rather than silently swallowing failures.
- Keep the existing FDA-first flow: user manually enables Full Disk Access, app verifies with real TCC probes, and no directory-level authorization fallback is introduced.

## Constraints

- Do not call Gemini.
- Do not handle manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve `.ccg/spec/guides/index.md` macOS permission model constraints.
- Do not stage or commit source changes; only CCG task metadata is archived and committed.
