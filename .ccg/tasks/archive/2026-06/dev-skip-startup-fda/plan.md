# Plan

## Implementation

- Add a small `isDevelopmentRuntime` helper in `App.tsx`.
- Use it to skip only the startup Full Disk Access preflight/polling modal in dev.
- Leave Settings diagnostics and protected-directory recovery behavior unchanged so production and release evidence stay strict.

## Verification

- Focused source tests for the dev guard.
- `npm test -- src/__tests__/permission-ux.test.ts`
- `npm run lint`
- `npm run lint:i18n`
- `npm run build`
