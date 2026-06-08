# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Add a release-candidate mode for `scripts/validate-macos-app-bundle.mjs`.
- Default validator behavior must still allow unsigned local/dev bundles with a warning.
- Release-candidate mode must fail when the `.app` has no signature marker.
- Release-candidate mode must fail when a signed app's entitlements cannot be inspected.
- Release-candidate mode may allow a signed non-sandbox app with no entitlement keys; entitlement keys must still be validated when present.
- Release-candidate mode must pass in tests when a signature marker and explicit valid entitlements plist fixture are supplied.
- Update release-candidate docs/spec so clean-user FDA acceptance uses strict app-bundle validation before first launch.
- Do not run `tccutil reset`, mutate TCC, or claim Full Disk Access is granted.
