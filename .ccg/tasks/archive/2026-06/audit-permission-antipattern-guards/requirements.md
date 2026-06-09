# Requirements

Code-only continuation for the macOS permission UX goal. This slice audits the remaining MoleUI permission anti-patterns and strengthens automated guards where current coverage is weak.

## Scope

- Compare the current codebase against MoleUI's FDA-first restrictions:
  - no directory-level authorization fallback;
  - no `NSOpenPanel` or security-scoped bookmarks in the core permission path;
  - no Apple Events/Finder/System Events/AppleScript for core file operations;
  - no `Scan Anyway` or equivalent bypass when FDA is denied;
  - no cached boolean as the source of truth for FDA;
  - no non-TCC default FDA probes.
- Prefer strengthening existing validator/test coverage over changing runtime code when the runtime behavior is already correct.

## Constraints

- Do not call Gemini.
- Do not handle manual acceptance, clean-user evidence collection, or certificate provisioning.
- Preserve `.ccg/spec/guides/index.md` macOS permission model constraints.
- Do not stage or commit source changes; only CCG task metadata is archived and committed.
