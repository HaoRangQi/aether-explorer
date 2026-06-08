# Analysis

- User constraint: do not call Gemini.
- Existing validator default mode intentionally allows unsigned local/dev bundles with a warning so developers can validate `Info.plist` metadata.
- Release-candidate evidence needs a stricter gate: a clean-user FDA acceptance run must not start from an unsigned app identity.
- For Aether's non-sandbox FDA-first model, a signed app can legitimately have no entitlement keys; absence of entitlements is not the same as a permission defect. The release gate should require a signed bundle and validate entitlement keys when they are present.

## Claude-Only Analysis

- Claude recommended adding a strict flag and keeping default behavior lenient.
- Claude's proposed "non-empty entitlements required" criterion is too strict for a non-sandbox app, where an empty entitlement set can be valid. This task uses a narrower release requirement:
  - require a signature marker for release-candidate validation,
  - fail if `codesign` cannot inspect a signed app,
  - validate forbidden entitlements when output exists,
  - allow no entitlement keys for a signed non-sandbox app.

## TDD

- Mode: auto
- Decision: strict
- Reason: permission/release gate behavior must fail closed for unsigned release candidates without breaking default dev validation.

## Pre-Edit Complexity Check

- Target edit file: `scripts/validate-macos-app-bundle.mjs`
- Existing pressure signal: small single-owner script, no overloaded module pressure.
- Owner fit: app-bundle validation behavior belongs in this script.
- Safer edit boundary: add CLI option and tests in existing validator test file.
- Decision: edit-in-place
