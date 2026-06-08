# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Add a local validator for a packaged macOS `.app` bundle's permission model metadata.
- Validator must check:
  - bundle path ends with `.app`,
  - `Info.plist` has expected `CFBundleIdentifier`, `CFBundleName` / display name, and version fields,
  - `Info.plist` keeps only allowed privacy usage descriptions,
  - code signature entitlements, when inspectable, do not include sandbox directory authorization or Apple Events entitlements,
  - if app sandbox entitlement is present, it must be `false`.
- Validator must not run `tccutil reset`, mutate TCC, or claim FDA is granted.
- Wire the validator into docs as a pre-clean-user-test check for release candidates.
- Do not claim the main permission UX goal is complete without clean-user FDA evidence.
