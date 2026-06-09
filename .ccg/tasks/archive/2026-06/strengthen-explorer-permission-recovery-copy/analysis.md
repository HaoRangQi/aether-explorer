# Analysis

## Finding

Explorer's permission recovery panel already had a detailed `t()` fallback in `ExplorerShell.tsx`, but the actual locale strings for `dialogs.permissionDeniedDescription` were generic:

- English: `Aether does not have permission to read this location. Grant access in System Settings.`
- Chinese: `Aether 没有权限读取此位置。请在系统设置中授予访问权限。`

Because the locale keys exist, users see the generic locale copy, not the richer fallback. That undercuts the MoleUI FDA model because repeated permission failures are often caused by stable app identity, signing, or install-path drift rather than the user not knowing where System Settings is.

## Implementation

- Updated English and Chinese `dialogs.permissionDeniedDescription` to explain macOS privacy protection and stable app identity/install-path drift.
- Updated `dialogs.permissionSteps` to name Aether Explorer and the concrete System Settings path.
- Replaced the ExplorerShell permission recovery fallbacks for title, description, actions, and steps with English fallbacks so the component no longer hides Chinese fallback copy.
- Added `permission-ux.test.ts` guardrails that the locale strings contain stable identity, exact app target, and Aether Explorer guidance.
- Updated Vitest count documentation from 291 to 292.

## Behavior

No FDA behavior changed. Directory classification, forced probes, blocked retry behavior, and one-shot retry remain unchanged.

## Remaining External Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.

