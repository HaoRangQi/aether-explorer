# Analysis

## Baseline

The project permission model follows the MoleUI FDA-first guidance:

- Aether is a non-sandbox macOS file manager.
- Full Disk Access is the core permission path.
- Directory-scoped sandbox entitlements, security-scoped bookmark setup, Apple Events, and unrelated privacy domains must not drift into the core path.
- Clean-user FDA testing is still required before claiming the UX is closed.

## Implementation

- Added `scripts/validate-macos-permission-model.mjs`.
- Added `npm run lint:macos-permissions`.
- Updated `npm run lint` to include the macOS permission model preflight.
- Updated `scripts/check-ci-gates.mjs` so `lint:macos-permissions` remains a required real script.
- Added `src/__tests__/macos-permission-model-validator.test.ts`.
- Updated `docs/SMOKE_TEST.md` and `docs/TEST_PLAN.md`.
- Updated `.ccg/spec/guides/index.md`.

## Validator Rules

The preflight fails when:

- `src-tauri/tauri.conf.json` does not use:
  - `productName: "Aether Explorer"`
  - `identifier: "com.aether.explorer"`
  - `bundle.active: true`
  - `bundle.macOS.entitlements: "Entitlements.plist"`
  - `bundle.macOS.infoPlist: "Info.plist"`
- `src-tauri/Entitlements.plist` does not keep `com.apple.security.app-sandbox` set to `false`.
- `src-tauri/Entitlements.plist` declares:
  - `com.apple.security.files.user-selected.read-write`
  - `com.apple.security.files.downloads.read-write`
  - `com.apple.security.files.bookmarks.app-scope`
  - `com.apple.security.automation.apple-events`
- `src-tauri/Info.plist` is missing the three allowed folder usage descriptions or declares unexpected `NS*UsageDescription` privacy keys.

## Boundary

This preflight checks static source configuration only. It does not inspect a signed `.app`, mutate TCC, or replace `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收`.

## Verification

- `npm run lint:macos-permissions`: passed
- `npm test -- macos-permission-model-validator`: passed, 1 file / 8 tests
- `npm run lint:ci-gates`: passed, 11 script implementations
- `npm run lint`: passed
- `npm test`: passed, 28 files / 258 tests
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
- `npm run build`: passed
