# Requirements

- Do not call Gemini.
- Add a dev-only evidence helper for Full Disk Access acceptance testing.
- The helper must not grant, reset, or mutate permissions.
- The helper should collect current app identity, FDA status/probes, window label, and browser user agent for manual release evidence.
- FDA probe validation must remain TCC-only and must reject user-content directory probes.
- Document the helper in the clean-user Full Disk Access smoke gate.
- TDD route: light. Add shape/validation tests before implementation.
