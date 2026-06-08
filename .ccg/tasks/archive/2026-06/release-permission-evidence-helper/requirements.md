# Requirements

- Do not call Gemini.
- Make `window.__aether.permissionEvidence()` available for release-candidate manual testing, not only DEV builds.
- Keep `window.__aether.smoke()` DEV-only.
- Keep evidence helper read-only: no permission grant, reset, mutation, or user-content directory probe.
- Preserve TCC-only FDA probe validation.
- Update docs to distinguish release-safe evidence capture from DEV-only smoke checks.
- TDD route: light source-level regression test before implementation.
