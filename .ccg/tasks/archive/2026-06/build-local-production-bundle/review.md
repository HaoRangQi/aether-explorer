# Review

## Scope

Built a local production macOS package for permission UX inspection outside `tauri dev`.

## Build

Command used:

```bash
npm run clean:release && npx @tauri-apps/cli build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Full release upload/signing flow was intentionally not run because it requires updater private key, GitHub authentication, and Developer ID signing context.

## Artifacts

- App: `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app`
- DMG: `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg`

## Validation

```bash
npm run validate:macos-app -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"
```

Result: passed.

Static identity checks:

- `CFBundleIdentifier`: `com.aether.explorer`
- `CFBundleName`: `Aether Explorer`
- `CFBundleShortVersionString`: `0.4.4`

Codesign inspection:

- `Signature=adhoc`
- `TeamIdentifier=not set`
- `Identifier=aether_explorer-47b64d31333604c2`

## Runtime Check

Launched the built app with:

```bash
open "src-tauri/target/release/bundle/macos/Aether Explorer.app"
```

Observed release build process:

- PID `48291`: `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/macos/Aether Explorer.app/Contents/MacOS/aether-explorer`

An existing installed app process was also running:

- PID `46862`: `/Applications/Aether Explorer.app/Contents/MacOS/aether-explorer`

## Notes

- Gemini was not called.
- This is a local production package, not Developer ID signed or notarized release evidence.
- Full Disk Access behavior is closer to production than `tauri dev`, but final release proof still requires stable signing and clean-user FDA evidence.
