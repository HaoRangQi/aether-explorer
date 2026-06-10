# Reflection

## Goal

Prepare and publish `v0.4.10` with release notes, documentation governance, version synchronization, and release validation.

## Deeper Cause

The release runbook had drifted from the actual workflow: the workflow now validates four version sources, uploads `SHA256SUMS`, and synchronizes the `stable` updater manifest. The documentation needed to be brought back to the executable release process before tagging.

The first `v0.4.10` release run exposed an implementation error in the release workflow update: Apple Developer ID `.p12` signing was incorrectly promoted from Full Disk Access acceptance evidence into a hard release workflow prerequisite. That contradicts the prior working `v0.4.4` workflow and the `codex/06` release definition, which require updater signing artifacts and remote manifest validation.

## Evidence

See `90-evidence.md`.

## Residual Risk

The corrected workflow still needs to be pushed and rerun before the release can be called complete. The release must not be considered complete until the remote `v0.4.10` release plus `stable/latest.json` pass verification.

## Decision

Repair the release workflow contract, keep the existing `v0.4.10` tag, dispatch the corrected workflow against that tag, and keep `.ccg/tasks/release-v0-4-10` unarchived until remote release verification passes.
