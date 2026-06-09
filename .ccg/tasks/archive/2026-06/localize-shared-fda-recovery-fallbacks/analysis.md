# Analysis

## Finding

After the blocked directory detail was localized, two shared permission recovery paths still carried Chinese fallback strings:

- `src/lib/operation-permission-error.ts`: fallback for `messages.fullDiskAccessOperationRequired`.
- `src/components/explorer/useExplorerInspector.ts`: fallback for `explorer.sizePermissionRequired`.

The locale files already define English and Chinese copy for both keys, so the hardcoded Chinese fallback was unnecessary. It also violated the CCG spec rule that shared FDA recovery copy should not embed one locale in shared hooks/libs.

## Implementation

- Changed both fallback strings to English.
- Extended `scripts/check-i18n-coverage.mjs` so it validates:
  - `dialogs.permissionRetryBlockedDetail`
  - `explorer.sizePermissionRequired`
  - `messages.fullDiskAccessOperationRequired`
  - the three corresponding source usages.
- Added a `permission-ux.test.ts` guardrail that the shared operation and inspector paths use i18n and no longer contain the Chinese FDA fallback literals.
- Updated test/i18n count documentation.
- Tightened the CCG guide from "shared permission hooks" to "shared permission hooks or libraries".

## Behavior

No FDA behavior changed. Permission classification, forced probes, blocked retry behavior, and one-shot auto retry are unchanged.

## Remaining External Gap

The broader permission UX goal still requires `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` on a clean macOS user, VM, or disposable machine, with saved FDA evidence passing `validate:fda-evidence` and `validate:macos-permission-release`.

