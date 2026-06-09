# Review

Gemini was intentionally not called because the active user constraint is code-only work for this goal and no Gemini usage. Manual acceptance, clean-user evidence, and certificate provisioning were explicitly left out of scope.

## Read-Only CCG Review

Review agent: `/root/review_fda_probe_state_invariants`

Result:

- Critical: None.
- Warning: None.
- Info: FDA probe state invariants are enforced in both `scripts/validate-fda-evidence.mjs` and `src/lib/full-disk-access-evidence.ts`, with coverage in `src/__tests__/fda-evidence-validator.test.ts` and `src/__tests__/smoke.test.ts`.
- The checks match `src-tauri/src/commands/fs.rs::probe_full_disk_access_target` for readable, not-found, and permission/read-error states.

## Verification

Fresh verification from the root agent:

- `npm test -- fda-evidence-validator smoke macos-permission-release-evidence-validator` passed: 3 files, 47 tests.
- `npm test` passed: 31 files, 322 tests.
- `npm run lint` passed: TypeScript, ESLint, and macOS permission model validation.
- `git diff --check` passed.

Review agent additionally reported `npm run test:rust` passed during read-only review.

## Result

Approved. The validators now reject impossible FDA probe state combinations:

- `readable: true` with `exists` not `true`;
- `readable: true` with an error string;
- `exists: false` with an error string.
