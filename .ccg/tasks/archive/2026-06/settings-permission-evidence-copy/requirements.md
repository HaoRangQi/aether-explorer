# Requirements

- Do not call Gemini.
- Add a Settings -> Permissions action to copy Full Disk Access acceptance evidence without using DevTools.
- Keep evidence collection read-only: no permission grant, reset, mutation, or user-content directory probe.
- Reuse the same evidence collector for Settings and `window.__aether.permissionEvidence()`.
- Keep `window.__aether.smoke()` DEV-only.
- Preserve TCC-only FDA probe validation.
- Update docs to prefer Settings copy action for release-candidate evidence and keep DevTools helper as a fallback.
- TDD route: light source-level wiring tests before implementation.
