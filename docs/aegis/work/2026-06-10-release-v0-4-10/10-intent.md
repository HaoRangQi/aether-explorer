# Task Intent Draft: Release v0.4.10

## Requested Outcome

Publish Aether Explorer `v0.4.10` after fully reviewing recent code changes, refreshing release/documentation governance, pushing the branch and tag, and verifying the remote GitHub Release.

## Scope

- Summarize user-visible changes since `v0.4.4`.
- Update version sources and release notes.
- Align release runbook/docs with the current four-source version gate.
- Run automated release gates before tagging.
- Push the branch/tag and verify the GitHub release assets and updater manifest.

## Non-Goals

- Manual clean-user Full Disk Access acceptance.
- Manual UI acceptance outside automated or release pipeline evidence.
- Reverting unrelated existing worktree changes.

## Baseline Read Set Hint

- `.ccg/spec/frontend/index.md`
- `.ccg/spec/guides/index.md`
- `codex/06-release-runbook.md`
- `.github/workflows/release.yml`
- `scripts/release.sh`

## Impact Statement Draft

This release touches distribution, updater metadata, user-facing release notes, macOS permission documentation, drag/drop behavior, and release automation. The release is high risk because CI must build signed universal macOS artifacts and publish a stable updater manifest.
