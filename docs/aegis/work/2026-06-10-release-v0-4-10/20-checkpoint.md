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

## Active Slice

Document and version governance.

## Blocked On

- Signed release build depends on GitHub Actions secrets and CI environment.

## Next Step

Update release documentation, changelog, and version files for `v0.4.10`.
