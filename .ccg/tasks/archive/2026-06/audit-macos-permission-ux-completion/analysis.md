# Analysis

## Scope

- Continue the macOS permission UX goal without calling Gemini.
- Audit current worktree implementation, tests, docs, and release gates against the MoleUI-inspired model:
  - non-sandbox file manager,
  - user-enabled Full Disk Access,
  - TCC-only status probes,
  - no repeated directory-level authorization,
  - unified recovery,
  - no Apple Events / Accessibility / extra privacy domains in the core path.

## Evidence Collected

- `.ccg/spec/guides/index.md` defines the current macOS permission model and release evidence gates.
- `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` states the same core model: one manual FDA setup, real probes, no directory authorization fallback, unified recovery, no extra privacy domains.
- Current implementation includes:
  - `src/lib/full-disk-access.ts` shared coordinator.
  - `src/lib/full-disk-access-evidence.ts` acceptance evidence collector.
  - `src/components/StartupPermissionPrompt.tsx` startup recovery UI.
  - `src/components/settings/PermissionsDiagnosticsSettings.tsx` single settings FDA surface.
  - `src/lib/operation-permission-error.ts` operation recovery copy.
  - `src-tauri/src/commands/fs.rs` TCC-only FDA probes.
  - validators under `scripts/validate-*.mjs`.

## Findings

- Automated permission tests and source permission model preflight pass locally.
- `rg` found no active code/config use of Apple Events, sandbox directory entitlements, or non-TCC FDA probes.
- Stale documentation remains in `docs/RELEASE_AUDIT.md`:
  - ACK-6 suggests future entitlements with directory-scoped sandbox permissions and Apple Events.
  - ACK-7 suggests probing `~/Library/Safari/History.db`.
- Those stale recommendations contradict the current permission spec and could mislead future release/security work.

## Decision

- Fix `docs/RELEASE_AUDIT.md` to match the current FDA-first model.
- Keep this task docs-only unless audit reveals an implementation gap.
