# Requirements

- Do not call Gemini; use local evidence and Claude-only review if external review is needed.
- Keep the MoleUI permission model: one manual Full Disk Access setup, real TCC probes, no directory-level authorization fallback, no new privacy domains.
- Settings -> Permissions must show the exact app identity users should enable in macOS Full Disk Access:
  - App name
  - Bundle ID
  - Version/build identity available from the running app
- Preserve existing Open System Settings, Reveal App in Finder, Check Again, status, and probe evidence controls.
- Add focused test coverage without increasing the implementation scope.
