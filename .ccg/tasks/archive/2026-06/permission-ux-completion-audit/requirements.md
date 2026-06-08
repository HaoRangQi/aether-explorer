# Permission UX Completion Audit Requirements

## Objective

Measure the current Aether Explorer macOS permission UX against the MoleUI FDA acceptance standard, and add a project-local verification entry point for the evidence that cannot be automated safely.

## Requirements

- Never call Gemini.
- Do not run destructive TCC commands such as `tccutil reset`.
- Use MoleUI README acceptance criteria as the source of truth.
- Distinguish automated evidence from clean-user/manual FDA evidence.
- Do not claim the global goal is complete unless all MoleUI acceptance items are proven.
- Keep business-code changes scoped to verification/documentation unless the audit reveals a concrete implementation defect.

## Evidence Needed

- Current code/docs inspected from the worktree.
- Project-local manual verification checklist exists for clean-user FDA testing.
- Automated checks pass for the touched files.
- Claude-only review or audit is recorded.
