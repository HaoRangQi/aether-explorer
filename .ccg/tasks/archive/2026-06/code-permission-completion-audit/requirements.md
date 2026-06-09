# Requirements

Code-only completion audit for the macOS permission UX goal.

## Source Requirements

From `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` and `.ccg/spec/guides/index.md`:

- Use a non-sandbox macOS file-manager model with user-enabled Full Disk Access.
- The app must not attempt to auto-enable FDA.
- FDA validity must be checked with real probes, not cached booleans as authority.
- When FDA is valid, core paths must not fall back to directory-level `NSOpenPanel` or security-scoped bookmarks.
- When FDA is denied or unknown, route to one recovery flow and do not scatter permission prompts across features.
- Denied state must not expose `Scan Anyway` or equivalent bypass.
- FDA recovery may retry a captured protected local operation exactly once after a forced granted probe.
- Manual retry from a blocked protected directory must run a forced FDA probe before re-reading.
- User-facing recovery copy must be localized and explain stable app identity/install-path drift.
- Default FDA probes must be TCC-only and must not create extra privacy-domain noise.
- Core copy/move/rename/trash operations must not use AppleScript/Finder/System Events, directory authorization fallbacks, or automatic `tccutil reset`.

## Non-Goals

- Do not call Gemini.
- Do not perform manual acceptance, clean-user runtime evidence collection, certificate provisioning, app notarization, or release proof.
- Do not stage or commit source changes unless explicitly requested; only CCG metadata may be archived/committed.
