# Requirements

- Do not call Gemini; use Claude-only review.
- Preserve current Full Disk Access behavior; this task only changes fallback copy and i18n coverage.
- Remove single-locale Chinese FDA recovery fallback text from shared hooks/libs.
- Keep localized English and Chinese locale keys as the source of user-facing FDA recovery copy.
- Ensure `npm run lint:i18n` covers the remaining shared FDA recovery keys and source usages.
- Add source-level tests preventing the Chinese fallback strings from returning to shared permission paths.
- Keep clean-user FDA release evidence as the remaining external acceptance gap.

