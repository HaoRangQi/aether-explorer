# Todo Checkpoint Draft

## Current Todo

- Read release runbook and specs.
- Inventory changes since `v0.4.4`.
- Update docs/version sources for `v0.4.10`.
- Run release gates.
- Commit, push branch and tag.
- Verify remote release assets and updater manifest.

## Completed

- Read `.ccg/spec/frontend/index.md` and `.ccg/spec/guides/index.md`.
- Read `codex/06-release-runbook.md`, `.github/workflows/release.yml`, and `scripts/release.sh`.
- Identified runbook drift: current release gates require `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to match the tag.
- Committed release prep as `80369ed chore: prepare release v0.4.10`.
- Pushed `codex/remote-access` and tag `v0.4.10`.
- Watched GitHub Actions release run `27222494242`; `test-gate` passed, `release` failed in `Validate release inputs`.
- Compared against `v0.4.4` release workflow and `codex/06-release-runbook.md`; prior working releases only required `TAURI_SIGNING_PRIVATE_KEY` for updater artifacts.
- Removed the incorrect Apple Developer ID `.p12` hard gate from `.github/workflows/release.yml`, `scripts/release.sh`, `scripts/check-ci-gates.mjs`, and `codex/06-release-runbook.md`.
- Dispatched release run `27247626585`; `test-gate` passed and release input validation passed, then universal build failed while compiling `openssl-sys` for `x86_64-apple-darwin` on an ARM macOS runner.
- Traced `openssl-sys` to `ssh2 -> libssh2-sys`, a new remote SFTP dependency absent from the working `v0.4.4` release.
- Enabled `ssh2` `vendored-openssl` in `src-tauri/Cargo.toml` and added a `lint:ci-gates` guard so future release builds do not depend on cross-arch pkg-config OpenSSL discovery.

## Active Slice

Repair universal release build and rerun `v0.4.10`.

## Blocked On

- Nothing external at this slice; the remaining work is to verify and rerun GitHub Actions.

## Next Step

Run release gate checks, move `v0.4.10` to the corrected release commit, push branch and tag, dispatch `release.yml` for `v0.4.10`, and verify remote release assets.
