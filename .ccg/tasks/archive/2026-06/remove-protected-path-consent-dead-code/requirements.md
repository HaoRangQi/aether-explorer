# Requirements

- Do not call Gemini.
- Use `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` as the baseline.
- Remove the unused Explorer "protected path consent" UI and state path that represented directory-level pre-access confirmation.
- Preserve the current Full Disk Access recovery behavior:
  - show FDA recovery only for local protected `PermissionDenied` while FDA is missing,
  - do not show FDA recovery for remote errors,
  - keep user-driven retry available,
  - keep repeated automatic reads blocked after a protected path permission failure until the user retries.
- Do not add directory-level `NSOpenPanel`, security-scoped bookmark, TCC reset, signing/notarization/helper/root/Admin Mode behavior.
- Verify source-level permission UX tests after removal.
