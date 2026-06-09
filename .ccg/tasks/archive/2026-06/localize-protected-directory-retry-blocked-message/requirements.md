# Requirements

- Do not call Gemini; use Claude-only review.
- Preserve the non-sandbox + user-enabled Full Disk Access model.
- Replace the hardcoded Chinese protected-directory retry blocked detail in the shared directory data hook with localized copy.
- Add English and Chinese locale entries for the new FDA recovery detail.
- Add the new key and usage to `npm run lint:i18n` coverage so it cannot regress silently.
- Add source-level guardrails in `permission-ux.test.ts`.
- Keep the external clean-user FDA evidence requirement unchanged; this task only improves localizable UX copy.

