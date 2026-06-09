# Analysis

## MoleUI Baseline

The relevant MoleUI docs converge on one permission model: a non-sandbox file manager asks the user to enable Full Disk Access once, verifies it with real TCC-only probes, and avoids per-directory authorization loops.

Key details from the docs:

- `README.zh-CN.md` explicitly requires one FDA setup, real probes instead of cached booleans, no directory-level `NSOpenPanel`/bookmark fallback when FDA is valid, and no repeated FDA recovery after retry failure.
- `macos-file-manager-permission-implementation.zh-CN.md` specifies a single coordinator that owns setup, polling and retry. It says authorization should retry the captured operation once, and if the retry still fails it should be classified as a normal file error rather than reopening FDA.
- `macos-file-manager-fda-clean-machine-verification.zh-CN.md` requires clean-user evidence for first launch, restart, upgrade, privacy-noise, and protected-path operations.

## Aether Gap

Aether already has a shared FDA coordinator, startup prompt, settings recovery, TCC-only probes, release evidence validation, and remote-permission separation. The remaining UX gap found in this pass was local directory recovery after the user grants FDA from an active directory failure:

1. The app blocked repeated permission prompts for the protected path.
2. The recovery UI let the user open System Settings and manually retry.
3. It did not automatically retry the captured failed directory once after FDA became granted.

That missed MoleUI's coordinator rule and left users doing an unnecessary manual retry after completing the system-level permission step.

## Implementation Decision

The directory data hook now stores the failed protected directory as a pending FDA retry. While that path is blocked and the error is an FDA-recoverable permission error, it polls `checkFullDiskAccessPermission({ force: true })`. Once status becomes `granted`, it unblocks the path and lets the normal directory load effect retry exactly once.

The retry is marked with `autoRetryingProtectedPathRef` so a second PermissionDenied after FDA has been granted is not requeued as another FDA recovery. Existing error classification then turns FDA-granted PermissionDenied into `generic`, which hides the FDA system-settings recovery controls and presents a normal read failure.

## Verification Added

- `src/__tests__/explorer-permission-auto-retry.test.tsx` covers successful auto retry and retry-failure no-loop behavior.
- `src/__tests__/permission-ux.test.ts` includes source-level guardrails for the polling refs and ensures the implementation does not double-retry by manually calling `refreshCurrentDir(false, retryPath)`.
- `docs/SMOKE_TEST.md` now asks clean-user testers to validate the protected-directory recovery retry behavior.
- `docs/TEST_PLAN.md` documents the new test file and updated Vitest count.

