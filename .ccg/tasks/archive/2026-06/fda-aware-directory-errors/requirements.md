# FDA-Aware Directory Error Requirements

## Objective

Avoid misleading users into Full Disk Access recovery for every `PermissionDenied` directory error. MoleUI's rule is that FDA recovery is appropriate only when a local protected operation fails and the current FDA probe is not `granted`.

## Requirements

- If a local directory read fails with `PermissionDenied` and FDA probe is `granted`, show it as a normal read failure instead of FDA recovery.
- If a local directory read fails with `PermissionDenied` and FDA probe is `denied` or `unknown`, keep FDA recovery.
- Remote directory permission failures must not show macOS System Settings / Full Disk Access recovery actions.
- Use the shared FDA coordinator for the real probe.
- Do not add directory authorization, `tccutil reset`, Apple Events, Gemini calls, or broad scanner refactors.

## Evidence Needed

- RED test fails before implementation.
- App error unit tests cover the FDA-aware classification rule.
- Permission UX source tests cover Explorer wiring and remote UI guard.
- TypeScript, ESLint, i18n, focused tests, full tests, build, and diff checks pass.
- Claude-only review is recorded.
