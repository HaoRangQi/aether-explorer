# FDA Coordinator Test Coverage Requirements

## Objective

Replace weak source-string evidence with executable tests for the shared Full Disk Access coordinator and dev smoke probe validation.

## Requirements

- Never call Gemini.
- Do not run destructive TCC commands.
- Verify `checkFullDiskAccessPermission` single-flights concurrent backend calls.
- Verify non-registration checks use the short cache and registration checks bypass it.
- Verify failed checks update the snapshot to `unknown`.
- Verify dev smoke FDA result validation rejects non-TCC probe paths.
- Keep implementation changes scoped to small helper extraction / test seams.

## Evidence Needed

- RED test fails before implementation.
- Focused Vitest tests pass.
- TypeScript and lint checks pass.
- Claude-only review is recorded.
