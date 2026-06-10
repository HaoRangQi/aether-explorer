# Review

## Root Cause Evidence

- Remote `v0.4.10` DMG app bundle reports:
  - `Identifier=aether_explorer-6a05626a5f6b8879`
  - `Signature=adhoc`
  - `TeamIdentifier=not set`
- The old local `0.4.4` app bundle also used ad-hoc signing, but with a different signing identifier hash. This means macOS TCC can treat updated builds as different clients even when the UI shows the same `Aether Explorer.app` name.
- Repository secrets currently contain only:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` are missing, so CI cannot produce a stable Developer ID-signed `.app` today.

## External Review

- Gemini review failed with status `41` because the current shell has no `GEMINI_API_KEY`.
- Claude review completed with status `0`.

Claude findings:

- Critical: `.p12` validation checked certificate readability with `openssl pkcs12 -nokeys`, but did not verify that the `.p12` includes a private key.
  - Fixed by extracting the private key with `openssl pkcs12 -nocerts -nodes ... -out "$KEY_FILE"` in both CI and local release script, then checking for a private-key PEM marker.
- Critical: suggested adding `APPLE_SIGNING_IDENTITY`.
  - Not applied. Tauri CLI 2.9 changelog states it infers the macOS codesign identity from `APPLE_CERTIFICATE` and no `APPLE_SIGNING_IDENTITY` support was found in local Tauri CLI/package sources.
- Minor docs/shell suggestions were reviewed. No additional blocking issue remained after the private-key check.

## Changes Reviewed

- `.github/workflows/release.yml`
  - Requires `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`.
  - Validates base64 `.p12`, certificate readability, and private-key presence.
  - Passes Apple certificate env vars to Tauri build.
  - Runs `npm run validate:macos-app:release -- "$APP_BUNDLE"` before uploading assets.
- `scripts/release.sh`
  - Fails locally without either `APPLE_CERTIFICATE` or a local `Developer ID Application:` codesigning identity.
  - Runs the same packaged app release validator before upload.
- `scripts/check-ci-gates.mjs`
  - Guards the Apple app signing checks and post-build validator so they cannot be removed silently.
- `codex/06-release-runbook.md`, `codex/12-macos-tcc-permissions.md`, `.ccg/spec/guides/index.md`
  - Clarify updater signing versus macOS app code signing.
  - Record the ad-hoc/no-TeamIdentifier failure mode.

## Verification

- `npm run lint:ci-gates` passed.
- `bash -n scripts/release.sh` passed.
- `npm run lint:macos-permissions` passed.
- `npm test -- src/__tests__/macos-app-bundle-validator.test.ts` passed: 20 tests.
- `npm test -- src/__tests__/macos-permission-release-evidence-validator.test.ts` passed: 6 tests.
- `npm run lint` passed.
- `npm test` passed: 31 files / 369 tests.
- `npm run build` passed, with the existing non-fatal Vite dynamic/static import warning for `src/lib/url-guard.ts`.
- `git diff --check` passed.
- `npm run validate:macos-app:release -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` failed as expected because the current local app is not release-signed.
- Remote `v0.4.10` DMG failed `validate:macos-app:release` as expected.

## Residual Risk

- This code change prevents future formal releases from uploading ad-hoc macOS app bundles.
- It does not retroactively fix the already-published `v0.4.10` asset.
- A working signed formal package still requires adding valid `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` repository secrets, then building a new release or replacing the existing release assets from a signed build.
