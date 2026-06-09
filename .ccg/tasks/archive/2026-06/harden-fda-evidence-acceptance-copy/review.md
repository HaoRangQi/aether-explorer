# Review

## Scope

Harden Settings "Copy evidence" and `window.__aether.permissionEvidence()` so release acceptance evidence cannot be produced while Full Disk Access is `denied` or `unknown`.

## Claude-Only External Review

Gemini was intentionally not called for this CCG task.

Claude raised two Critical clarification items based on the focused review snippets:

- Verify `window.__aether.permissionEvidence()` uses the same protected collector.
- Verify Settings `granted` is derived from the Full Disk Access status.

Both were resolved against the current code:

- `src/lib/smoke.ts` assigns `permissionEvidence: collectFullDiskAccessAcceptanceEvidence`, so DevTools uses the same collector validation.
- `src/components/settings/PermissionsDiagnosticsSettings.tsx` derives `granted` as `permissionStatus === 'granted'`.
- `src/components/settings/useSettingsPermissions.ts` gets `permissionStatus` from `useFullDiskAccessPermission()`, which is populated by the `full_disk_access_status` command.
- `src/lib/full-disk-access-evidence.ts` restricts probe paths to TCC-only locations.

No unresolved Critical or Warning findings remain.

## Verification

Passed:

```bash
npm test -- src/__tests__/smoke.test.ts src/__tests__/permission-ux.test.ts src/__tests__/fda-evidence-validator.test.ts
npm run lint:i18n
npm run lint:ts
npm test
npm run lint
npm run lint:ci-gates
git diff --check
npm run build
```

`npm run build` still reports the pre-existing Vite warning about `src/lib/url-guard.ts` being both dynamically and statically imported.
