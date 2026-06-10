# Review

## Release Shape

- Tag: `v0.5.0-adhoc.1`
- Build type: ad-hoc single-DMG prerelease
- Artifact: `src-tauri/target/release/bundle/dmg/Aether Explorer_0.5.0-adhoc.1_aarch64.dmg`
- Stable updater: not updated
- Updater assets: not uploaded

## App Bundle Evidence

Mounted DMG app bundle reports:

- `CFBundleIdentifier=com.aether.explorer`
- `CFBundleShortVersionString=0.5.0-adhoc.1`
- `CFBundleVersion=0.5.0-adhoc.1`
- `Signature=adhoc`
- `TeamIdentifier=not set`
- signing `Identifier=aether_explorer-69411e9d42aaf637`

This matches the intended ad-hoc channel and must not be treated as stable Full Disk Access release evidence.

## Verification

- `npm run lint:ci-gates` passed.
- `npm run lint` passed.
- `npm test` passed: 31 files / 369 tests.
- `npm run lint:readme` passed.
- `npm run lint:i18n` passed.
- `npm run test:rust` passed: 132 tests.
- `npm run lint:rust` passed.
- `git diff --check` passed.
- Tauri DMG build passed with `--bundles dmg --ci --config '{"bundle":{"createUpdaterArtifacts":false}}'`.
- Mounted DMG passed `npm run validate:macos-app -- "$APP"`.
- Mounted DMG failed `npm run validate:macos-app:release -- "$APP"` as expected for an ad-hoc build.

## Residual Risk

- Full Disk Access may require reauthorization for this package.
- This release is for direct DMG download only and does not provide updater metadata.
- Formal stable release still requires Apple Developer ID app signing and the full release checklist.
