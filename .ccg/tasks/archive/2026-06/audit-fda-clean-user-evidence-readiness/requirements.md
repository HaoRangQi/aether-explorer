# Requirements

- Audit whether the current workspace has enough evidence to close the clean-user Full Disk Access release gate.
- Verify local `.app` bundles against the macOS app validator and distinguish dev/static checks from release-candidate checks.
- Keep `validate:fda-evidence` protected by CI gate drift checks because the final combined validator depends on it.
- Do not call Gemini; use local evidence and Claude-only review.

