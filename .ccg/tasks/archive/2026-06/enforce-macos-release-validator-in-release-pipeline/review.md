# Review

## External Review

- Reviewer: Claude only
- Gemini: skipped by explicit user instruction

## Findings

- Critical: none.
- Major: none.
- Minor: APP_BUNDLE lookup is duplicated in local release script, GitHub workflow, and CI gate expectations by design. Exact string enforcement means future drift is caught by `npm run lint:ci-gates`.

## Behavior

- `scripts/release.sh` now locates the built `.app` and runs `npm run validate:macos-app:release -- "$APP_BUNDLE"` before staging/uploading release assets.
- `.github/workflows/release.yml` now runs the same validator after `npx @tauri-apps/cli build --target universal-apple-darwin` and before release asset upload.
- `scripts/check-ci-gates.mjs` now fails if either release path removes APP_BUNDLE lookup or the release validator invocation.

## Verification

- RED: `npm run lint:ci-gates` initially failed because both release paths lacked APP_BUNDLE lookup and `npm run validate:macos-app:release -- "$APP_BUNDLE"`.
- GREEN: `npm run lint:ci-gates` passed after wiring both release paths.
- `npm test -- src/__tests__/macos-app-bundle-validator.test.ts src/__tests__/macos-permission-model-validator.test.ts` passed: 2 files / 28 tests.
- `npm test` passed: 29 files / 278 tests.
- `npm run lint` passed.
- `npm run lint:readme` passed with 23 tracked headings.
- `npm run lint:i18n` passed with documented locale/usage counts.
- `git diff --check` passed.
- `npm run validate:macos-app:release -- "src-tauri/target/release/bundle/macos/Aether Explorer.app"` failed as expected because the current local app is not release-valid signed.
- `npm run build` passed with the existing non-fatal Vite dynamic/static import warning for `src/lib/url-guard.ts`.

## Residual Risk

- This closes the release-pipeline bypass gap for the app-bundle release validator.
- It still does not provide a stable signed release candidate.
- It still does not provide clean-user Full Disk Access evidence.
- The main permission UX goal remains open until a release-valid signed app passes the release validator and clean-user FDA evidence passes `npm run validate:fda-evidence`.
