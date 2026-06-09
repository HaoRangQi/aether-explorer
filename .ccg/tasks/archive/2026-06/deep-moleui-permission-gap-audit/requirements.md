# Requirements

- Preserve Aether's non-sandbox + user-enabled Full Disk Access model.
- Do not call Gemini for CCG analysis or review; use Claude-only review while Gemini is unconfigured.
- Compare Aether's current permission UX with MoleUI's FDA documents under `/Users/macos/Downloads/Projects/mole-ui/docs/`.
- Keep one shared FDA recovery path instead of reintroducing directory-level authorization or security-scoped bookmarks.
- When a protected local directory fails because FDA is missing, capture that directory as the recovery operation.
- While the FDA recovery UI is active, poll real FDA status with a forced check.
- After FDA becomes `granted`, retry the captured directory exactly once.
- If that retry still fails, show a normal directory read failure and do not reopen or loop the FDA recovery flow.
- Keep remote permission failures out of macOS FDA recovery.
- Update smoke/test documentation so clean-user validation covers the recovered-directory retry behavior.

