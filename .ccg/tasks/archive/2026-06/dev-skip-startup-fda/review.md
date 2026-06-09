# Review

## Scope

- Added an `import.meta.env.DEV` guard for the startup Full Disk Access preflight in `App.tsx`.
- Startup FDA polling is also disabled in development runtime.
- Settings diagnostics, production FDA startup probe, Rust TCC probes, and macOS permission model remain unchanged.

## Findings

- Critical: none found in local review.
- Warning: Gemini was not called per user constraint; no external double-model review was performed.
- Info: Development can now open without the blocking FDA setup modal. Protected macOS directories may still fail if the debug binary lacks access; use existing manual navigation/import flows or a formal packaged app for release-grade FDA validation.

## Verification

- `npm test -- src/__tests__/permission-ux.test.ts`
- `npm run lint`
- `npm run lint:i18n`
- `npm run build`
- `git diff --check`
- `npm run dev` started successfully on port 41873.
