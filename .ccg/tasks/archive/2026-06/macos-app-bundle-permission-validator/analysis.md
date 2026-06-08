# Analysis

- User constraint: do not call Gemini; use Claude-only review if external review is needed.
- Existing spec requires Aether's core macOS permission model to remain non-sandbox + user-enabled Full Disk Access.
- Source-level validation already exists through `npm run lint:macos-permissions`, but clean-user FDA acceptance still depends on the packaged `.app` identity and entitlements matching that source model.
- This task adds a manual release-candidate preflight for packaged `.app` bundles. It must not mutate TCC, run `tccutil reset`, sign/notarize the app, or claim FDA is granted.

## TDD

- Mode: auto
- Decision: strict
- Reason: permission/release gate logic should fail closed when bundle identity or entitlements drift.
- RED evidence: `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` initially failed because a missing app bundle reported a nested `Info.plist` error instead of the missing `.app` directory.
