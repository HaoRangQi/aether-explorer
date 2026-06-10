# Requirements

## User Request

- Publish a new release with one simple package only.
- Use the local DMG output from `src-tauri/target/release/bundle/dmg/`.
- The release can use a name such as `v0.5.0-*`; choose a clear tag.
- Document the tradeoff clearly.

## Scope

- Create an ad-hoc release channel that uploads only one `.dmg`.
- Do not update `stable/latest.json`.
- Do not upload updater tarballs, signatures, or checksum manifests for this ad-hoc release.
- Do not claim stable Full Disk Access persistence for this ad-hoc build.

## Chosen Release

- Tag: `v0.5.0-adhoc.1`
- Artifact: one local DMG built from current source.
