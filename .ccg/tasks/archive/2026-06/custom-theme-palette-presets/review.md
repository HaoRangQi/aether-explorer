# Review

## Scope

Implemented a user custom theme palette group for the appearance settings:

- Default base font is now `Apple Braille`.
- Theme settings can persist `customColorPalettes`.
- Users can name and save the current accent color plus detailed color controls as a custom preset.
- Saved presets can be applied or deleted from the appearance page.
- Custom presets participate in theme normalization and settings backup import sanitization.

## TDD

RED:

```bash
npm test -- src/__tests__/settings.test.ts
```

Expected failures observed:

- default font was still `Inter`
- custom palette presets were not normalized
- build/apply helper functions did not exist

GREEN:

```bash
npm test -- src/__tests__/settings.test.ts
```

Result: 35 tests passed.

## Review

Gemini was not called.

Attempted Claude wrapper review, but `codeagent-wrapper --backend claude` exited with status 1 and produced no review report.

Ran `ccg-review` as a local read-only review fallback. It reported and fixed two Warning-level issues:

- `src/App.tsx`: top-level app shell still used `unset` as font fallback; changed to `DEFAULT_FONT_FAMILY`.
- `src/components/settings/AppearanceSettings.tsx`: custom palette name input relied on placeholder text and allowed unbounded names; added `aria-label` and `maxLength={48}`.

Remaining Info:

- Worktree contains many unrelated dirty files from prior permission/release work. They were not reverted or reviewed as part of this custom palette task.

## Verification

All commands passed after the review fixes:

```bash
npm test -- src/__tests__/settings.test.ts
npm test
npm run lint
npm run build
npm run lint:i18n
npm run lint:readme
npm run lint:ci-gates
git diff --check
```

Observed full Vitest result:

```text
31 files / 334 tests passed
```

`npm run build` still reports the existing non-fatal Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
