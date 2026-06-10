# Review: release-v0-4-10 OpenSSL universal build fix

## External Model Review

- Gemini reviewer: unavailable. `codeagent-wrapper --backend gemini` failed with `GEMINI_API_KEY` missing from the current environment.
- Claude reviewer: unavailable. `codeagent-wrapper --backend claude` exited with status 1 and did not return a review report.

## Local Review

### Critical

- None found.

### Warning

- The existing `v0.4.10` tag must be moved to the corrected release commit before rerunning `release.yml`, because workflow_dispatch uses the branch workflow file but the `Checkout` step checks out `${RELEASE_TAG}`. Rerunning without moving the tag would rebuild the old `Cargo.toml`.

### Info

- `src-tauri/Cargo.toml` is the correct owner for this fix. `cargo tree -i openssl-sys` traced the failing OpenSSL dependency to `ssh2 -> libssh2-sys -> openssl-sys`; enabling `ssh2` `vendored-openssl` routes the fix through the dependency contract instead of adding fragile runner-specific Homebrew paths.
- `scripts/check-ci-gates.mjs` now prevents the same release regression by requiring `ssh2` `vendored-openssl`.
- `Cargo.lock` is not tracked in this repository, so the releasable source of truth is `src-tauri/Cargo.toml`. Local Cargo commands regenerated the untracked lockfile only as build state.
- `codex/06-release-runbook.md` now records the `openssl-sys` universal build failure mode and keeps the release completion definition tied to artifacts, updater signature, `latest.json`, `SHA256SUMS`, and `stable/latest.json`.

## Verification Reviewed

- `cargo tree --manifest-path src-tauri/Cargo.toml -i openssl-sys -e features`
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin`
- `npm run lint:ci-gates`
- `npm run lint`
- `npm run test:rust`
- `npm run lint:rust`
- `npm test`
- `npm run build`
- `npm run lint:readme`
- `npm run lint:i18n`
- `git diff --check`
