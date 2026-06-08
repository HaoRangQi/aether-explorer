# Requirements

- Do not call Gemini.
- Do not run `tccutil reset` or mutate macOS TCC state.
- Add a local validator for FDA acceptance evidence copied from Settings or `window.__aether.permissionEvidence()`.
- Validator must fail if evidence is missing required identity/runtime fields, if FDA status is not `granted`, or if probes are not TCC-only.
- Wire the validator into docs so clean-user FDA acceptance has an objective command to run after collecting JSON.
- Keep implementation small and aligned with existing `scripts/` conventions.
- Do not claim the global permission UX goal is complete without real clean-user evidence.
