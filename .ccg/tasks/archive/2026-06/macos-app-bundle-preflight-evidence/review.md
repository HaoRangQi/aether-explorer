# Review

## External Review

- Reviewer: Claude only
- Gemini: skipped by explicit user instruction

## Findings

- Critical: none.
- Major: the original debug-bundle evidence was scoped correctly but too narrow for permission enforcement because it did not validate signed entitlements and did not prove release parity.
- Warning: this task should not claim the packaged-bundle permission-critical preflight is closed unless signed entitlements are inspectable.

## Resolution

- Added a release-profile app bundle build:
  - `npx @tauri-apps/cli build --bundles app --ci --config '{"bundle":{"createUpdaterArtifacts":false}}'`
  - Result: exited `0`.
- Validated the generated release app:
  - `npm run validate:macos-app -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"`
  - Result: exited `0`.
  - Warning retained: `codesign reported no entitlements; static Info.plist checks still ran.`
- Confirmed `_CodeSignature` is absent, so signed entitlements remain unverified.

## Claim Boundary

This task closes the local debug/release `.app` static metadata preflight only:

- Generated app bundles have expected bundle identity and version metadata.
- Generated app bundles keep only the allowed Desktop/Documents/Downloads privacy usage descriptions among checked keys.
- Source-level macOS permission model and validator tests still pass.

This task does not close:

- signed entitlements validation,
- production updater/signing artifact validation,
- clean-user Full Disk Access acceptance,
- `validate:fda-evidence` release evidence.

## Next Required Evidence

- Build or obtain a production-equivalent signed app and run `npm run validate:macos-app -- /path/to/Aether\ Explorer.app` with inspectable entitlements.
- On a clean macOS user / VM, grant Full Disk Access and save evidence that passes `npm run validate:fda-evidence -- /path/to/fda-evidence.json`.
