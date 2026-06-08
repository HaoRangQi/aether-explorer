# Review

## External Review

Claude-only review was run for this task. Gemini was intentionally not called per user instruction.

### Critical

- None.

### Warning

- Claude asked whether Desktop / Documents / Downloads usage descriptions in `Info.plist` are still needed under an FDA-only model.
- Resolution: accepted as a documented boundary. The MoleUI implementation guide recommends keeping those three descriptions as necessary fallback/system explanation text while avoiding unrelated privacy domains.

### Info

- Entitlements cleanup approved. `com.apple.security.files.user-selected.read-write` and `com.apple.security.files.downloads.read-write` were misleading in a non-sandbox FDA model and should stay removed.
- Source-level regression coverage prevents the sandbox file entitlements, bookmark entitlement, and Apple Events entitlement from returning.

## Verification

- `npm test -- permission-ux`: passed, 17 tests
- `npm test`: passed, 26 files / 241 tests
- `npm run lint:ts`: passed
- `npm run lint:eslint`: passed
- `npm run lint:i18n`: passed
- `npm run lint:readme`: passed
- `git diff --check`: passed
- `npm run test:rust`: passed, 129 tests
- `npm run lint:rust`: passed
