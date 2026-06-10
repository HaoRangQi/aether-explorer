# Review

## Root Cause

- The first `v0.5.0-adhoc.1` DMG contained an app with only linker ad-hoc signing.
- It had no `Contents/_CodeSignature`, and `validate:macos-app:release` failed with `Release-candidate validation requires a signed app bundle with Contents/_CodeSignature`.
- Browser-downloaded unsigned/ad-hoc apps can receive `com.apple.quarantine`; without a complete bundle signature, macOS can report the app as damaged.

## Fix

- Rebuilt the DMG with Tauri config:

```bash
npx @tauri-apps/cli build --bundles dmg --ci \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}'
```

- Replaced the single GitHub Release asset for `v0.5.0-adhoc.1`.
- Updated release notes with quarantine fallback:

```bash
xattr -rd com.apple.quarantine /Applications/Aether\ Explorer.app
```

## Evidence

Mounted rebuilt DMG app bundle:

- `Contents/_CodeSignature`: present
- `CFBundleIdentifier=com.aether.explorer`
- `CFBundleShortVersionString=0.5.0-adhoc.1`
- `Identifier=com.aether.explorer`
- `Signature=adhoc`
- `TeamIdentifier=not set`
- `codesign --verify --deep --strict --verbose=4`: valid on disk, satisfies designated requirement
- `npm run validate:macos-app -- "$APP"`: passed
- `npm run validate:macos-app:release -- "$APP"`: failed as expected because this is ad-hoc, not Developer ID-signed

Remote release:

- URL: `https://github.com/HaoRangQi/aether-explorer/releases/tag/v0.5.0-adhoc.1`
- Asset count: 1
- Asset digest: `sha256:3686d103b05934310e0d4a62444c6c239b5a4a6d924c18bb9bcf20f2c411b289`
- Local DMG sha256 matches remote digest.
- `stable/latest.json` remained `0.4.10`.

## Residual Risk

- The package is still ad-hoc signed, not Developer ID-signed or notarized.
- On some macOS setups, quarantine may still block launch after browser download; the documented `xattr` command is the fallback.
