# Requirements

- Do not call Gemini.
- Align startup Full Disk Access setup with MoleUI guidance:
  - show current app name, Bundle ID, version, and app path
  - show non-blocking `/Applications` stability guidance when relevant
  - provide Reveal App in Finder from the startup setup
  - keep Open System Settings and Check Authorization
- Share app identity loading logic between Settings and startup setup.
- Do not add reset, `tccutil`, directory-level authorization fallback, new privacy domains, or any automatic permission-changing behavior.
- TDD route: strict. Add failing permission UX assertions first, then implement.
