# Review

## External Review

- Reviewer: Claude only
- Gemini: skipped by explicit user instruction
- First pass finding:
  - Critical: docs test counts were inconsistent. Fixed `docs/TEST_PLAN.md` and `docs/SMOKE_TEST.md` to the verified `29` Vitest files / `271` tests.
  - Critical: untracked validator implementation was not visible in the first diff-only prompt. Resolved by running a second workspace-file review and verifying the implementation directly.

## Second Pass Findings

### Addressed

- Signed app bundles now fail closed when a `_CodeSignature` directory exists but `codesign` cannot inspect entitlements.
- Entitlement validation now rejects `com.apple.security.app-sandbox` values that are not the boolean `false`.
- Entitlement validation now checks `com.apple.application-identifier`, when present, and requires it to match the expected bundle identifier suffix.
- Plist inputs now have a minimal XML plist/dict shape check before key validation.
- Tests now cover signed-app entitlements inspection failure, malformed `Info.plist`, non-boolean sandbox values, mismatched application identifiers, and missing explicit entitlement fixture files.
- Smoke docs now clarify that the app bundle validator runs in the clean user / VM before first launch and does not start the app or mutate TCC.
- Spec now states that the packaged validator checks bundle id/name/version, privacy keys, and inspectable entitlements only.

### Accepted / Not Changed

- Full XML parsing was not added. The validator is a release-candidate preflight for build-tool-generated plists, not an adversarial XML parser. The added shape check and targeted key validation are sufficient for this gate without adding a new parser dependency.
- `check-ci-gates` already verifies `validate:macos-app` runs `node scripts/validate-macos-app-bundle.mjs`; the second review's contrary note was a false positive against current file state.
- Version format validation was not added because the current task is the macOS permission model, not app-store/notarization/version policy.

## Verification

- `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` passed: 1 file / 13 tests.
- `npm test` passed: 29 files / 271 tests.
- `npm run lint` passed, including `npm run lint:macos-permissions`.
- `npm run lint:ci-gates` passed with 12 script implementations.
- `npm run lint:readme` passed with 23 tracked headings.
- `npm run lint:i18n` passed with 74 locale keys and documented usage counts.
- `git diff --check` passed.
- `npm run test:rust` passed: 129 Rust tests.
- `npm run lint:rust` passed.
- `npm run build` passed with the existing non-fatal Vite dynamic/static import warning for `src/lib/url-guard.ts`.

## Residual Risk

- This validator does not prove Full Disk Access is granted. Clean-user FDA acceptance and `npm run validate:fda-evidence -- /path/to/fda-evidence.json` are still required before claiming the overall permission UX goal is complete.
