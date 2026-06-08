# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Add a combined release evidence validator that requires:
  - a release-valid signed `.app` passing `validate:macos-app:release`,
  - an FDA evidence JSON passing `validate:fda-evidence`,
  - `appIdentity` in the evidence matching the `.app` bundle identity, version, and path.
- The validator must not run `tccutil reset`, mutate TCC, grant FDA, sign/notarize the app, or launch the app.
- Update package scripts, docs, and gate metadata so the command is discoverable and protected from removal.
- Do not claim the main permission UX goal is complete without real clean-user evidence.
