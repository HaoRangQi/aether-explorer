# Requirements

- Do not call Gemini.
- Align with MoleUI FDA guidance that stable app identity and installation path reduce repeated Full Disk Access prompts.
- Settings -> Permissions must show the current app path alongside app name, Bundle ID, and version.
- If the current app path is outside `/Applications` and `/System/Applications`, show a non-blocking hint recommending moving Aether to `/Applications` before granting Full Disk Access for better persistence.
- Do not add reset, `tccutil`, directory-level authorization fallback, new privacy domains, or any automatic permission-changing behavior.
- TDD route: strict. Add the failing source-level permission UX test first, then implement.
