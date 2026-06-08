# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Add a local preflight validator for Aether's macOS permission model configuration.
- Validator must check source configuration for the FDA-first model:
  - app sandbox disabled,
  - no sandbox directory authorization entitlements,
  - no Apple Events entitlement,
  - no unexpected macOS privacy usage descriptions,
  - Tauri config points at the expected entitlement and Info.plist files,
  - bundle identity/product fields are present.
- The validator must not run `tccutil reset` or mutate macOS TCC state.
- Wire the validator into package scripts and release/smoke docs.
- Do not claim the main permission UX goal is complete without clean-user FDA evidence.
