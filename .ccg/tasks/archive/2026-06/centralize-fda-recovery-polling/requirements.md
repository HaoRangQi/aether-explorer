# Requirements

- Centralize Full Disk Access auto-polling in the shared frontend FDA coordinator.
- Preserve startup permission prompt behavior: poll only while visible and close automatically once FDA is `granted`.
- Preserve Explorer protected-directory behavior: retry the captured protected directory once after FDA becomes `granted`, and do not reopen recovery if that retry fails.
- Preserve manual retry behavior: run one forced FDA probe before relisting and do not relist while FDA is still `denied` or `unknown`.
- Do not change backend probe paths, entitlements, or the release evidence schema.
- Do not call Gemini; use Claude-only analysis and review.

