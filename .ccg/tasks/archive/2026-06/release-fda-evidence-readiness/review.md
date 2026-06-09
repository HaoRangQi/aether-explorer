# Review

## External Analysis

Claude-only analysis session: `6787b04e-38cd-4e95-a61a-338f9834f2ba`

Gemini was intentionally not called because the active user goal says to ignore Gemini for this permission UX work.

The analysis confirmed:

- This machine cannot complete the final release/FDA evidence gate now because it has no valid Apple code signing identity and no clean-user FDA evidence JSON.
- Existing validators correctly reject ad-hoc app bundles for release evidence.
- A high-value local improvement was to make the release pipeline explicitly require Apple app code signing inputs instead of only Tauri updater signing.

## Review Rounds

### Round 1

Claude review session: `04f27a56-df42-4c12-a916-5c1b0558d7a4`

Findings:

- Critical: `APPLE_CERTIFICATE` should be validated as base64/PKCS12 content before the build.
- Critical/Warning: local codesigning fallback should be tighter than a generic SHA-1 identity check.
- Warning: `check-ci-gates` should enforce the new signing requirements.

Actions taken:

- Added base64 decode, decoded size, and `openssl pkcs12` checks in CI.
- Added the same Apple certificate validation in `scripts/release.sh`.
- Tightened local fallback to require `Developer ID Application:`.
- Extended `scripts/check-ci-gates.mjs` release security checks.

### Round 2

Claude review session: `e3ecd66e-7eae-4113-8993-ad462f178b26`

Findings:

- Critical: `mktemp -t apple-cert).p12` left the original temp file orphaned.
- Warning: broaden the openssl failure message beyond password-only troubleshooting.

Actions taken:

- Removed the appended `.p12` suffix from both CI and local script temp file paths.
- Broadened the certificate read failure messages.

### Final Review

Claude review session: `535dccfe-88fe-41f5-9501-9fa51ec5b3c3`

Result:

- No remaining Critical, Warning, or Info issues materially affecting release signing, FDA release evidence confidence, shell correctness, or secret handling.

## Verification

- `npm run lint:ci-gates` passed.
- `npm run lint:macos-permissions` passed.
- `bash -n scripts/release.sh` passed.
- `npm run lint` passed.
- `git diff --check` passed.

## Remaining Final Goal Gap

The overall permission UX goal remains incomplete until a release candidate is signed with a valid Apple app signing identity and clean-user FDA evidence is captured and validated with the combined release evidence gate.
