# Analysis

- User constraint: do not call Gemini.
- Existing `npm run validate:macos-app:release` can reject unstable macOS app signing identities before clean-user Full Disk Access acceptance.
- Current gap: local `scripts/release.sh` and GitHub `.github/workflows/release.yml` build and upload artifacts without running the release app validator on the produced `.app`.
- Correct insertion point: after Tauri build and artifact discovery, before any upload or release manifest generation that would publish invalid artifacts.

## Claude-Only Analysis

- Claude recommended wiring `npm run validate:macos-app:release -- "$APP_BUNDLE"` into both release paths after build and before upload.
- Claude confirmed test-gate-only validation is insufficient because there is no built `.app` yet.
- Out of scope: Developer ID signing setup, notarization/stapling, TCC mutation, or FDA grant automation.

## TDD

- Mode: auto
- Decision: strict
- Reason: release pipeline gates must fail closed when the validator is removed or skipped.
- RED evidence: `npm run lint:ci-gates` failed after adding expected release validator commands because release paths did not yet contain them.

## Pre-Edit Complexity Check

- Target edit files: `scripts/check-ci-gates.mjs`, `scripts/release.sh`, `.github/workflows/release.yml`
- Existing pressure signal: release scripts are linear and already contain artifact discovery sections.
- Owner fit: release validator belongs after app bundle generation and before upload.
- Safer edit boundary: reuse existing `BUNDLE_DIR` logic and add exact gate expectations.
- Decision: edit-in-place
