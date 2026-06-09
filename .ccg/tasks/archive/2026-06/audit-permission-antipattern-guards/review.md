# Review

## Scope

Audited and strengthened automated guards for remaining macOS FDA-first permission anti-patterns. This slice is code-only and excludes manual Full Disk Access acceptance, clean-user evidence, certificate provisioning, and release proof.

## Changes Reviewed

- `scripts/validate-macos-permission-model.mjs`
  - Rejects duplicate or enabled `com.apple.security.app-sandbox` declarations by requiring exactly one plist boolean value set to `false`.
  - Rejects AppleScript/Finder/System Events, `NSOpenPanel`/security-scoped bookmark APIs, and automatic `tccutil reset` in the core transfer path.
  - Scans `fs.rs` core file-operation commands after stripping the current non-core macOS integration helpers, then separately scans `rename_file`, `delete_to_trash`, and `trash_delete_error`.
- `src/__tests__/macos-permission-model-validator.test.ts`
  - Adds RED/GREEN fixtures for forbidden core AppleScript/Finder automation, directory authorization fallbacks, automatic TCC reset, duplicate sandbox keys, and hidden helper automation.
- `src/__tests__/permission-ux.test.ts`
  - Adds UI source guards against denied-state bypass copy/actions such as `Scan Anyway`, `Remind Me Later`, and `Open Anyway`.
- `.ccg/spec/guides/index.md`
  - Captures the core file-operation anti-pattern guard as a project convention.

## External Review

Gemini was intentionally not called because the user explicitly required Gemini to be ignored.

Claude-style local review agents were used instead:

- First review: no Critical findings; two Warnings found.
  - `rename_file`, `delete_to_trash`, and `trash_delete_error` were initially scanned only by direct function bodies, so forbidden automation could be hidden in helpers.
  - Sandbox validation initially did not reject duplicate contradictory app-sandbox keys.
- Follow-up fixes added tests and validator logic for both warnings.
- Final review: no Critical or Warning findings.

## Verification

- `npm test -- macos-permission-model-validator`
  - RED before fixes: 3 new anti-pattern cases failed as expected.
  - RED after review warnings: 2 follow-up cases failed as expected.
  - Final GREEN: 15 tests passed.
- `npm test -- macos-permission-model-validator permission-ux`
  - 2 files / 38 tests passed.
- `npm run lint:macos-permissions`
  - Passed.
- `npm run lint`
  - Passed.
- `npm test`
  - 31 files / 329 tests passed.
- `npm run lint:i18n`
  - Passed.
- `git diff --check`
  - Passed.
- `cargo test` from `src-tauri`
  - 129 Rust tests passed.

## Known Non-Slice Finding

- `cargo clippy --all-targets -- -D warnings` failed on existing clean `src-tauri/src/remote.rs` test constant assertions. `src-tauri/src/remote.rs` has no current diff and this is outside the macOS permission UX slice.

## Verdict

No Critical or Warning findings remain for this slice. The remaining scope excluded by the user is manual/runtime acceptance and release evidence.
