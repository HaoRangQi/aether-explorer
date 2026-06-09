# Analysis

## Finding

Before this task, `src/lib/full-disk-access.ts` centralized FDA probe state, single-flight, and short-cache behavior, but automatic polling still lived in two places:

- `src/App.tsx` while the startup Full Disk Access setup prompt was visible.
- `src/components/explorer/useExplorerDirectoryData.ts` while a protected local directory was blocked by FDA.

This left room for duplicate forced probes when both surfaces were active.

## Approach

Add `startFullDiskAccessPolling()` to the shared FDA coordinator. Multiple active subscribers share one timer in the current window context, while each subscriber keeps its own cleanup and `onResult` behavior.

Manual retry remains a direct one-shot forced probe and is not converted to polling.
