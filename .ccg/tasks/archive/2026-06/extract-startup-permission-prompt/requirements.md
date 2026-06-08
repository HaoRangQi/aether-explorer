# Requirements

- Do not call Gemini.
- Extract the startup Full Disk Access modal out of `src/App.tsx` into an owned component.
- Preserve the user-facing startup permission flow exactly: Open System Settings, Reveal App in Finder, Check Authorization, app identity fields, stable install hint, loading and error states.
- Do not change Full Disk Access probing, registration, polling, localStorage lock, TCC probes, or backend commands.
- Reduce `App.tsx` UI complexity without introducing new permission behavior.
- TDD route: light structural test first, then refactor.
