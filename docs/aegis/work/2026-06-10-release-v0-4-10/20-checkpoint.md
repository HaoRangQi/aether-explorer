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
- Updated `codex/06-release-runbook.md` with the missing `APPLE_CERTIFICATE` secret prerequisite and failure mode.

## Active Slice

Release blocked on external signing material.

## Blocked On

- GitHub repo lacks `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` secrets for Developer ID Application `.p12` code signing.
- Local machine has no valid code-signing identities and no discovered `.p12` certificate files.

## Next Step

Configure Apple Developer ID signing secrets, then rerun `release.yml` for `v0.4.10`.
