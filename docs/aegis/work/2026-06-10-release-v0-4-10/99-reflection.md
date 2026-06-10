# Reflection

## Goal

Prepare and publish `v0.4.10` with release notes, documentation governance, version synchronization, and release validation.

## Deeper Cause

The release runbook had drifted from the actual workflow: the workflow now validates four version sources, uploads `SHA256SUMS`, and synchronizes the `stable` updater manifest. The documentation needed to be brought back to the executable release process before tagging.

The first `v0.4.10` release run exposed an implementation error in the release workflow update: Apple Developer ID `.p12` signing was incorrectly promoted from Full Disk Access acceptance evidence into a hard release workflow prerequisite. That contradicts the prior working `v0.4.4` workflow and the `codex/06` release definition, which require updater signing artifacts and remote manifest validation.

The second run exposed the actual packaging regression introduced by the new remote access scope: SFTP added `ssh2`, which pulls `libssh2-sys` and `openssl-sys`. On the GitHub ARM macOS runner, the universal build compiles an `x86_64-apple-darwin` target, and `openssl-sys` cannot use normal pkg-config discovery for that cross-target. The dependency owner is `src-tauri/Cargo.toml`, not the release workflow environment.

## Evidence

See `90-evidence.md`.

## Residual Risk

The automated release is complete under `codex/06`: release assets, updater signature, versioned `latest.json`, `SHA256SUMS`, and `stable/latest.json` all validate remotely. Clean-user Full Disk Access acceptance remains intentionally outside this code-only release task.

## Decision

Repair the release workflow contract, vendor OpenSSL through the SFTP dependency, move the incomplete `v0.4.10` tag to the corrected release commit, publish the GitHub Release, verify the updater manifests remotely, then archive `.ccg/tasks/release-v0-4-10`.
