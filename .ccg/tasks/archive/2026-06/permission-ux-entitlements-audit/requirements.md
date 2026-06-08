# Requirements

- Do not call Gemini.
- Use `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` as the permission UX baseline.
- Re-audit current permission implementation from source, not memory.
- Preserve the current macOS permission model:
  - one Full Disk Access surface,
  - app identity shown for recovery,
  - user-driven fresh rechecks,
  - local protected `PermissionDenied` recovery only,
  - remote permission errors do not show macOS recovery,
  - repeated protected-path automatic reads stay blocked until retry.
- Do not add NSOpenPanel, security-scoped bookmarks, TCC reset, signing/notarization/helper/root/Admin Mode behavior in this task.
- Identify any remaining code-side or evidence-side gap before claiming the main permission UX goal is complete.
