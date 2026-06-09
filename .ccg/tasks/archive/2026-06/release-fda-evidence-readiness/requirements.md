# Requirements

Continue the macOS permission UX goal by closing release/evidence readiness gaps that can be handled without a local Apple signing identity or clean macOS user.

## Constraints

- Do not call Gemini for this active permission UX goal.
- Do not stage or commit business/source/workflow changes as part of CCG archival.
- Preserve the FDA-first non-sandbox model from `.ccg/spec/guides/index.md`.
- Final goal still requires:
  - signed release `.app` passing `npm run validate:macos-app:release -- /path/to/Aether\ Explorer.app`;
  - clean-user FDA evidence JSON passing `npm run validate:fda-evidence -- /path/to/fda-evidence.json`;
  - combined gate passing `npm run validate:macos-permission-release -- --app /path/to/Aether\ Explorer.app --evidence /path/to/fda-evidence.json`.

## Observed State

- `security find-identity -v -p codesigning` returned `0 valid identities found`.
- Existing debug/release app bundles pass `npm run validate:macos-app`.
- Existing debug/release app bundles fail `npm run validate:macos-app:release` because `Contents/_CodeSignature` is missing.
- `codesign -dv` on the release app reports ad-hoc/linker signing, `TeamIdentifier=not set`, and non-release signing identifier.
- No local FDA evidence JSON was found outside ignored build/dependency directories.

## Implemented Slice

- Require `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` in GitHub release workflow.
- Pass Apple certificate inputs to the Tauri build step so macOS `.app` code signing can produce a stable TeamIdentifier.
- Validate `APPLE_CERTIFICATE` before build by base64-decoding it, checking decoded size, and reading it with `openssl pkcs12`.
- Make local `scripts/release.sh` fail before build when neither `APPLE_CERTIFICATE` nor a local `Developer ID Application:` identity exists.
- Extend `scripts/check-ci-gates.mjs` so these release signing requirements remain enforced.
