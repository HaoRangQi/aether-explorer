# Review

## External Review

- Reviewer: Claude only
- Gemini: skipped by explicit user instruction

## Findings

- Critical: none.
- Major: none.
- Minor:
  - Removed undocumented `--strict` alias so the public CLI surface only exposes `--require-signature`.
  - Clarified the warning for signed apps with no entitlement keys: this can be valid for a non-sandbox FDA-first app.

## Behavior

- `npm run validate:macos-app -- <app>` remains default/lenient for local bundles:
  - unsigned app bundles can pass static metadata validation with a warning.
- `npm run validate:macos-app:release -- <app>` runs `--require-signature`:
  - unsigned app bundles fail before clean-user FDA acceptance,
  - signed app bundles with unreadable entitlements fail,
  - entitlement keys are validated when present,
  - signed non-sandbox apps with no entitlement keys are allowed with an explicit warning.

## Verification

- RED: `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` failed before implementation because `--require-signature` was unknown.
- GREEN: `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` passed: 1 file / 16 tests.
- `npm test` passed: 29 files / 274 tests.
- `npm run lint` passed, including source-level macOS permission validation.
- `npm run lint:ci-gates` passed with 13 script implementations.
- `npm run lint:readme` passed with 23 tracked headings.
- `npm run lint:i18n` passed with documented locale/usage counts.
- `git diff --check` passed.
- `npm run validate:macos-app -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` passed with the expected unsigned warning.
- `npm run validate:macos-app:release -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` failed as expected because the local release bundle is unsigned and lacks `Contents/_CodeSignature`.
- `npm run build` passed with the existing non-fatal Vite dynamic/static import warning for `src/lib/url-guard.ts`.

## Residual Risk

- This closes the unsigned-release-candidate preflight gap.
- It still does not provide clean-user Full Disk Access evidence.
- It still requires an actual signed release candidate to pass `npm run validate:macos-app:release -- /path/to/Aether\ Explorer.app` before clean-user FDA acceptance.
