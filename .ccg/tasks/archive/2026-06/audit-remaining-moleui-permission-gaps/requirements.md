# Requirements

- Never call Gemini for this task; use Claude-only analysis/review.
- Continue Aether's non-sandbox + user-enabled Full Disk Access model.
- Compare remaining permission UX against MoleUI FDA documents.
- Do not add sandbox directory entitlements, security-scoped bookmarks, Apple Events, or Desktop/Documents/Downloads FDA probes.
- Keep startup/settings/directory recovery on forced real FDA probes for user-driven checks.
- Keep the startup FDA prompt non-skippable in the core path; do not add a "skip for now" bypass.
- For a blocked protected local directory, manual retry must first check FDA with `{ force: true }`.
- If that manual check is still `denied` or `unknown`, do not re-read the protected directory.
- If a forced check reports `granted`, retry the captured protected directory once through the normal load effect.
- Preserve the existing rule that a retry failure after FDA is granted becomes a normal file read error rather than another FDA recovery.
- Document remaining external acceptance: clean-user FDA evidence is still required before the overall goal can be called complete.

