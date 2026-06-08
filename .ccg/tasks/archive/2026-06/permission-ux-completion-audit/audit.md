# Permission UX Completion Audit

Source: `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md`

## Verdict

Current state: **design and automated verification are substantially complete; clean-user FDA closure is still unproven**.

Do not mark the overall permission UX goal complete until the project-local clean-user gate in `docs/SMOKE_TEST.md` is executed and recorded on a disposable macOS user / VM / test machine.

## Acceptance Matrix

| MoleUI criterion | Current evidence | Status |
| --- | --- | --- |
| App cannot auto-enable FDA; it must guide the user to System Settings | `open_system_settings` only opens `Privacy_AllFiles`; UI copy explains manual grant; no grant API exists in code | Automated design evidence present; real System Settings appearance still needs clean-user proof |
| Authorization source of truth must be real probe, not cached boolean | `full_disk_access_status` probes TCC paths; startup/settings use `checkFullDiskAccessPermissions`; old startup done state is not used as authorization source | Proven by source tests and code |
| Settings/startup share one coordinator | `src/lib/full-disk-access.ts` uses `useSyncExternalStore`, `inFlightCheck`, and a short 2.5s non-registration cache | Proven by source tests and Claude review |
| Do not probe user Desktop/Documents/Downloads contents for FDA status | `default_full_disk_access_probe_targets` only points at `/Library/Application Support/com.apple.TCC` and `~/Library/Application Support/com.apple.TCC`; smoke and Rust tests cover this | Proven by tests |
| When FDA is granted, do not route normal PermissionDenied errors into FDA recovery | `directoryErrorKindForFullDiskAccess` downgrades FDA-granted permission errors to generic; Explorer local loader checks current FDA status | Proven by `app-error.test.ts` and source wiring tests |
| Remote permission failures must not show macOS FDA recovery | Remote loader uses ordinary directory error classification; `ExplorerShell` gates FDA recovery with `!isRemoteRoot` | Proven by source tests |
| Do not use directory-level authorization/bookmarks as core fallback | No security-scoped bookmark usage found; `openDialog` remains for explicit user file/folder selection commands, not as core protected-directory fallback | Source evidence present |
| Do not use Finder/System Events/AppleScript for core copy/move/delete/trash | Core copy/move are in `commands::transfer`; rename/delete/trash are Rust filesystem commands. Existing `osascript` is for icon/open-with/app-picker/terminal integration, not core file operations | Source evidence present; terminal/open-with remain separate safety boundary |
| App appears in Full Disk Access list | Requires clean-user run; `register_full_disk_access` performs a real TCC-gated probe to encourage registration | Missing manual evidence |
| Manual grant flips probe to `granted` | Requires clean-user run and `window.__aether.smoke()` / Settings check | Missing manual evidence |
| Quit/reopen preserves authorization | Requires clean-user run | Missing manual evidence |
| Replace/upgrade preserves authorization when identity is stable | Requires release-candidate install/replace run. Current config has stable `identifier` and product name; code-signing identity stability is not proven here | Missing manual evidence |
| Default probe creates no unrelated privacy-domain noise | Info.plist only declares Desktop/Documents/Downloads folder usage descriptions; no NSAppleEvents / removable volumes / file provider declarations. Actual System Settings/TCC noise still requires clean-user inspection | Partially proven; manual evidence missing |
| No destructive TCC reset in normal flow | No `tccutil reset` in app/runtime path; smoke docs explicitly forbid running it on the primary user | Proven by search for runtime code; release/manual docs still require operator discipline |

## Evidence Gathered This Slice

- `npm test -- --reporter=dot`: 23 files / 217 tests passed.
- `cargo test --lib -- --list`: 127 Rust tests listed.
- Search confirmed no `security-scoped` / bookmark fallback in source.
- Search confirmed `osascript` is not used by core copy/move/delete/trash paths.
- Updated `docs/SMOKE_TEST.md` with a Full Disk Access clean-user release gate.
- Updated `docs/TEST_PLAN.md` with current test baselines and FDA evidence boundary.

## Non-Goals Preserved

- No Gemini call.
- No `tccutil reset`.
- No signing/notarization/helper/admin/root mode work.
- No scanner/analyzer rewrite.

## Remaining Proof Needed

Run `docs/SMOKE_TEST.md` section `0.1 Full Disk Access 干净用户验收` and record:

- macOS version.
- build hash and install path.
- bundle id and app bundle name.
- first-launch registration result.
- manual grant result.
- quit/reopen result.
- replace/upgrade result.
- unrelated privacy-domain inspection result.
- protected-directory operation result.
- remote permission failure UI result.
