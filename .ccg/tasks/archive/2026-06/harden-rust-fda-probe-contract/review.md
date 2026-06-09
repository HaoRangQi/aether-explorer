# Review

## Scope

Hardened the macOS Full Disk Access probe contract around:

- `scripts/validate-macos-permission-model.mjs`
- `src/__tests__/macos-permission-model-validator.test.ts`
- `src-tauri/src/lib_tests.rs`

Gemini was intentionally not called because the active user goal says to ignore Gemini for this permission UX work.

## Verification

- `npm run lint:macos-permissions` passed.
- `npm test -- macos-permission-model-validator` passed: 1 file, 10 tests.
- `npm run test:rust` passed: 129 tests.
- `npm run lint` passed.
- `npm run lint:rust` passed.

## Claude-Only Review

Claude reviewer session: `1d0a21e5-4f78-485d-9521-834432cdc39d`

### Critical

None.

### Warning

None.

### Info

- The reviewer noted that `register_full_disk_access` validation intentionally accepts only the canonical direct delegation forms:
  - `full_disk_access_status()`
  - `return full_disk_access_status()`
- This strictness is accepted because the validator is meant to prevent drift into a separate registration or mutation path.

## Result

Approved. The source validator and Rust tests now enforce that default Full Disk Access probes remain limited to the three TCC targets and that registration remains a direct TCC probe delegation.
