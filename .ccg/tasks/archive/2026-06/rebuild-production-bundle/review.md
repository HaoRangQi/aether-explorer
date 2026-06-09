# Review

## Build

Command:

```bash
npm run clean:release && npx @tauri-apps/cli build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Artifacts:

- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
- `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`

Sizes:

- App bundle: 22M
- DMG: 8.7M

## Verification

- Tauri production build: passed.
- `npm run validate:macos-app -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"`: passed.
- `hdiutil verify "src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg"`: passed.
- `Info.plist` values:
  - `CFBundleIdentifier`: `com.aether.explorer`
  - `CFBundleName`: `Aether Explorer`
  - `CFBundleShortVersionString`: `0.4.4`

## Signing Note

The local bundle is ad-hoc signed:

- `Signature=adhoc`
- `TeamIdentifier=not set`

This is suitable for local inspection, but it is not Developer ID release evidence.

## Notes

- Full release automation was not run because it can require updater keys, GitHub authentication, and Developer ID credentials.
- Gemini was not called.
- Business source changes were not staged or committed.
