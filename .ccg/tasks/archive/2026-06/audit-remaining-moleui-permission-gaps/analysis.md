# Analysis

## Scope

This pass audited remaining MoleUI FDA model gaps after the existing Aether permission work. The checked surfaces were:

- Startup and settings Full Disk Access coordinator wiring.
- Local directory recovery after PermissionDenied.
- Core file operation permission formatting.
- Rust/Tauri FDA probes, app reveal commands, entitlements, and release evidence validators.
- Smoke/test documentation.

## Findings

### Confirmed Already Aligned

- Startup uses `checkFullDiskAccessPermissions({ force: true, registration: true })`; localStorage is only a short cross-window lock and prompt-close signal, not the authorization source of truth.
- Settings recheck and operation PermissionDenied classification use forced FDA probes.
- FDA probes are TCC-only and do not read Desktop/Documents/Downloads user content as status evidence.
- Entitlements keep the app non-sandboxed and avoid directory-scoped sandbox permissions and Apple Events.
- Remote permission failures are not routed into macOS FDA recovery.
- Captured protected directory auto retry after FDA becomes `granted` is covered by behavior tests.

### Actionable Gap

The protected directory recovery "Retry" button called `refreshCurrentDir()` directly. When the path was still blocked and FDA was still denied, this caused another protected directory read before checking the fresh FDA state. MoleUI's coordinator rules prefer user-driven recovery controls to run a real FDA probe first, and only retry the captured operation after that probe reports `granted`.

## Decision

`retryProtectedPath` now distinguishes blocked protected paths from ordinary retry:

- If the current path is not blocked, it keeps the existing generic refresh behavior.
- If the current protected path is blocked, it calls `checkFullDiskAccessPermission({ force: true })`.
- If the result is not `granted`, it leaves the block in place and does not call `listDirectory`.
- If the result is `granted`, it marks the path as auto-retrying and clears the block; the normal directory load effect performs the single captured retry.

This preserves the one-retry/no-loop rule and reduces repeated protected directory reads while the user has not actually enabled FDA.

## Rejected Suggestion

Claude analysis suggested adding a startup "skip for now" button. This was not adopted because Aether's current CCG guardrails and tests intentionally require no startup skip button in the core FDA path; allowing users to bypass setup would recreate the scattered permission failure path the MoleUI model is trying to avoid.

## Remaining External Gap

The broader goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing both evidence validation and release app/evidence pairing validation.

