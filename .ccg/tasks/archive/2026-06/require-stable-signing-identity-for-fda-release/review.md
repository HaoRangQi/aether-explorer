# Review

## External Review

- Reviewer: Claude only
- Gemini: skipped by explicit user instruction

## Findings

- Critical: TeamIdentifier empty-string edge case should be explicit.
  - Resolution: added explicit `teamIdentifier.trim().length === 0` guard and a regression test.
- Major: CodeDirectory ad-hoc parsing could be more precise.
  - Resolution: changed broad substring check to a `flags=0x...(...adhoc...)` regex.
- Major: signing Identifier mismatch error should explain FDA persistence.
  - Resolution: updated error message to mention Full Disk Access persistence across updates.

## Behavior

- Default `npm run validate:macos-app -- <app>` remains lenient for local/dev bundles.
- `npm run validate:macos-app:release -- <app>` now requires:
  - signed app marker,
  - inspectable code-signing identity,
  - non-ad-hoc signature,
  - non-empty TeamIdentifier that is not `not set`,
  - code-signing `Identifier=com.aether.explorer`.
- Entitlement keys are still validated when present.
- Notarization/stapling is out of scope for this gate.

## Verification

- RED: `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` failed before implementation because `--signature-info` was unknown.
- GREEN: `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` passed: 1 file / 20 tests.
- `npm test` passed: 29 files / 278 tests.
- `npm run lint` passed, including source-level macOS permission validation.
- `npm run lint:ci-gates` passed with 13 script implementations.
- `npm run lint:readme` passed with 23 tracked headings.
- `npm run lint:i18n` passed with documented locale/usage counts.
- `git diff --check` passed.
- `npm run validate:macos-app -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` passed with the expected unsigned/static metadata warning.
- `npm run validate:macos-app:release -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` failed as expected because the current local bundle lacks release-valid signing identity.
- `npm run build` passed with the existing non-fatal Vite dynamic/static import warning for `src/lib/url-guard.ts`.
- `npm run test:rust` passed: 129 Rust tests.
- `npm run lint:rust` passed.

## Residual Risk

- This closes the ad-hoc/no-TeamIdentifier release validation gap.
- It still does not provide a real signed release candidate.
- It still does not provide clean-user Full Disk Access evidence.
- The main permission UX goal remains open until a release-valid signed app passes `validate:macos-app:release` and clean-user FDA evidence passes `validate:fda-evidence`.
