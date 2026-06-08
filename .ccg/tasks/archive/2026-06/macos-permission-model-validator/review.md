# Review

## External Review

Claude-only review was run twice. Gemini was intentionally not called per user instruction.

## First Review

### Critical

- Missing test coverage for the primary sandbox-disabled constraint.
- Missing test coverage for stable identity validation.

### Warning

- Missing test coverage for required folder usage descriptions.
- Forbidden entitlement tests covered only one key.
- Script needed header documentation explaining the FDA-first model.

### Resolution

- Added sandbox-enabled rejection test.
- Added product name / bundle identifier rejection test.
- Added missing `NSDownloadsFolderUsageDescription` rejection test.
- Added Apple Events entitlement rejection test.
- Added script header and inline rationale comments.

## Re-review

### Critical

- None.

### Warning

- None.

### Info

- Forbidden entitlement keys are intentionally rejected by presence, regardless of value.
- Smoke docs now explain that TCC-only probe evidence avoids mistaking user-content reads for FDA status.

## Verification

- `npm run lint:macos-permissions`: passed
- `npm test -- macos-permission-model-validator`: passed, 1 file / 8 tests
- `npm run lint:ci-gates`: passed, 11 script implementations
- `npm run lint`: passed
- `npm test`: passed, 28 files / 258 tests
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
- `npm run build`: passed
