# Analysis

## MoleUI Baseline

Source: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md`

Relevant requirements for this slice:

- Use one manual Full Disk Access setup instead of repeated directory-level authorization.
- Treat real FDA probes as the source of truth; do not rely on cached booleans.
- Do not add destructive TCC reset behavior.
- Do not expand into extra privacy domains, helpers, root/admin mode, signing, or notarization in this slice.
- Keep recovery unified and only show FDA recovery when the local protected path failure is plausibly caused by missing FDA.

## Current-State Findings

- No independent `analyze-go` or disk-analyzer binary path was found in the current tree. `StorageView` is currently a capacity overview and does not perform directory scanning through a separate helper.
- The existing FDA coordinator already provides a shared frontend source for startup and settings, with single-flight behavior and a short 2.5s cache.
- The short cache is useful for passive/background checks, but it can produce stale results for user-driven recovery and PermissionDenied classification immediately after the user changes FDA in System Settings.

## Chosen Improvement

Add `force?: boolean` to the shared FDA coordinator:

- `force: true` bypasses only the short TTL cache.
- `registration: true` still selects `register_full_disk_access`.
- Both options can be true.
- In-flight backend probes still single-flight across forced and default callers.

Fresh probes are now used for:

- startup permission setup and visible startup polling,
- Settings -> Permissions manual "Check again",
- local protected directory PermissionDenied classification,
- protected file-operation PermissionDenied copy,
- protected directory-size PermissionDenied copy.

This moves the implementation closer to the MoleUI "real probe, not cache" model without removing the cache as an internal optimization.
