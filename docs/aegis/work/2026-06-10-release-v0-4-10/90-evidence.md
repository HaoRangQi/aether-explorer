# Evidence Bundle Draft

## Commands

- `npm run lint:readme` — passed.
- `npm run lint:i18n` — passed.
- `npm run lint:ci-gates` — passed.
- `npm run lint` — passed.
- `npm test` — passed, 31 files / 369 tests.
- `npm run test:rust` — passed, 132 Rust lib tests.
- `npm run lint:rust` — passed.
- `npm run build` — passed.
- `cargo check --manifest-path src-tauri/Cargo.toml` — passed.
- `git diff --check` — passed.

## Release Inputs Checked

- `package.json` version: `0.4.10`
- `package-lock.json` version: `0.4.10`
- `src-tauri/tauri.conf.json` version: `0.4.10`
- `src-tauri/Cargo.toml` version: `0.4.10`
- `CHANGELOG.md` contains `## [0.4.10] - 2026-06-10`.
- `codex/06-release-runbook.md` aligned to the current four-source version gate and stable manifest validation.

## Not Covered

- Clean-user Full Disk Access acceptance remains a manual release evidence step.
- Signed macOS universal artifact creation and GitHub Release asset validation are covered by the release workflow after the tag is pushed.
