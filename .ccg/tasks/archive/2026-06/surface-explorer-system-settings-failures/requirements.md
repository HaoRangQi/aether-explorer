# Requirements

Code-only continuation for the macOS permission UX goal. This slice closes the remaining silent Full Disk Access recovery failure in the main Explorer permission error panel.

## Scope

- Explorer's permission recovery panel must show a localized error if `open_system_settings` fails.
- The error must use `normalizeAppError(err).userMessage`.
- Coverage must prevent reintroducing `safeInvoke('open_system_settings').catch(() => {})` in Explorer recovery.
- Keep the FDA-first model: user manually enables Full Disk Access, app verifies with real TCC probes, and no directory-level authorization fallback is introduced.

## Constraints

- Do not call Gemini.
- Do not handle manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve `.ccg/spec/guides/index.md` macOS permission model constraints.
- Do not stage or commit source changes; only CCG task metadata is archived and committed.
