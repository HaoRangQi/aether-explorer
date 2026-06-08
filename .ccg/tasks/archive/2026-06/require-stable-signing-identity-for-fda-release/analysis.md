# Analysis

- User constraint: do not call Gemini.
- Previous release mode required a signature marker but did not inspect signing identity stability.
- Current local release bundle `codesign -dv` output includes:
  - `Signature=adhoc`
  - `TeamIdentifier=not set`
  - `Identifier=aether_explorer-47b64d31333604c2`
- That is not enough for stable Full Disk Access release evidence because macOS TCC persistence depends on a stable signed app identity.

## Claude-Only Analysis

- Claude agreed release validation should reject ad-hoc signatures, missing TeamIdentifier, and mismatched signing identifier.
- Notarization/stapling remains out of scope; this gate validates signing identity stability for FDA persistence only.

## TDD

- Mode: auto
- Decision: strict
- Reason: permission/release gate logic must fail closed for unstable signing identities.

## Pre-Edit Complexity Check

- Target edit file: `scripts/validate-macos-app-bundle.mjs`
- Existing pressure signal: small single-owner validator script.
- Owner fit: code-signing identity checks belong in the packaged app validator.
- Safer edit boundary: add a `--signature-info` fixture path for tests and inspect real `codesign -dv` output in production mode.
- Decision: edit-in-place
