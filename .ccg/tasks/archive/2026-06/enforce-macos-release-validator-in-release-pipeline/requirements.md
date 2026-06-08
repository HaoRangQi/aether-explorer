# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Ensure local `scripts/release.sh` runs `npm run validate:macos-app:release -- "$APP_BUNDLE"` on the built `.app` before uploading or generating release evidence.
- Ensure GitHub `.github/workflows/release.yml` runs the same release app validator before uploading release artifacts.
- Update `scripts/check-ci-gates.mjs` so the release validator cannot be removed from either release path unnoticed.
- Do not implement Developer ID signing, notarization, helper tools, TCC reset, or Full Disk Access grant automation in this task.
- Do not claim the main permission UX goal is complete without clean-user FDA evidence.
