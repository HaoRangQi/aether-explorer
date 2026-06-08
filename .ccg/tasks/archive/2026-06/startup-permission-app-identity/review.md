# Startup Permission App Identity Review

## Scope

- Startup Full Disk Access setup now shows app name, Bundle ID, version, and app path.
- Startup setup includes stable `/Applications` guidance when the current app path is not stable.
- Startup setup keeps Open System Settings, Reveal App in Finder, and Check Authorization.
- Settings and startup share app identity loading through `src/lib/app-identity.ts`.
- No reset, `tccutil`, directory-level authorization fallback, new privacy domains, or automatic permission-changing behavior was added.

## TDD

- RED: `npm test -- permission-ux` failed after adding assertions for shared app identity single-flight wiring.
- GREEN: `src/lib/app-identity.ts` now uses module-level snapshot state, `inFlightAppIdentity`, listeners, and `useSyncExternalStore`.

## Review

- Gemini: not called, per user instruction.
- Claude-only review:
  - Initial finding: `useAppIdentity()` was shared by name but each mounted consumer could still call `get_app_identity`; fixed with single-flight module state.
  - Re-review: no Critical or Major issues. One Minor clarity suggestion was applied by splitting the in-flight and cached return paths.
- Startup `done` localStorage was not restored as an authorization source of truth. The current behavior intentionally re-probes startup state so revoked Full Disk Access is detected instead of hidden by stale local storage.

## Verification

- `npm test -- permission-ux` failed before implementation as expected.
- `npm test -- permission-ux` passed: 12 tests.
- `npm run lint:ts` passed.
- `npm run lint:eslint` passed.
- `npm run lint:i18n` passed.
- `npm test` passed: 26 files / 230 tests.
- After the final clarity patch:
  - `npm test -- permission-ux` passed: 12 tests.
  - `npm run lint:ts` passed.

## Residual Risk

- This closes the startup app identity slice, but the overall permission UX goal is not complete until the `docs/SMOKE_TEST.md` section `0.1` clean-user Full Disk Access acceptance is executed and recorded on a release candidate.
