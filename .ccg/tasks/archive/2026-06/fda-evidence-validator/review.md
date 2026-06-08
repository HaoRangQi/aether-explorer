# Review

## External Review

Claude-only review was run twice. Gemini was intentionally not called per user instruction.

## First Review

### Critical

- None.

### Warning

- TCC path validation accepted arbitrary nested paths under `com.apple.TCC`.
- Resolution: fixed by restricting accepted paths to the TCC directory itself and `TCC.db`.

### Info

- Non-`.app` app paths may warn for dev builds.
- Resolution: warning text now explicitly says this can be normal for dev builds and release acceptance should use the `.app` bundle.

## Re-review

### Critical

- None.

### Warning

- None.

### Info

- Duplicate TCC path logic exists in the runtime validator and Node script; accepted as defense in depth, with tests covering both.
- Rejection coverage includes Desktop, Downloads, iCloud Drive, and arbitrary nested TCC paths.

## Verification

- `npm test -- fda-evidence-validator smoke`: passed, 2 files / 14 tests
- `npm run validate:fda-evidence -- <valid sample JSON>`: passed
- `npm test`: passed, 27 files / 250 tests
- `npm run lint:ts`: passed
- `npm run lint:eslint`: passed
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `npm run lint:ci-gates`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
