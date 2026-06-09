# Requirements

Code-only continuation for the macOS permission UX goal. This slice reduces the wait after a user enables Full Disk Access while a setup/recovery UI is visible.

## Scope

- Align the shared FDA polling interval with the MoleUI PermissionCoordinator guidance: default visible setup/recovery polling should run every 1 second.
- Keep the existing coordinator shape: one shared timer, forced real probes during visible recovery, and timer cleanup when no subscribers remain.
- Add focused coverage so the default interval does not drift back to a slower value.

## Constraints

- Do not call Gemini.
- Do not handle manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve `.ccg/spec/guides/index.md` macOS permission model constraints.
- Do not stage or commit source changes; only CCG task metadata is archived and committed.
