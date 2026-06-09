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
- `git commit -m "chore: prepare release v0.4.10"` — created `80369ed`.
- `git push origin codex/remote-access` — pushed branch.
- `git tag v0.4.10 && git push origin v0.4.10` — pushed release tag.
- `gh run watch 27222494242 --exit-status` — failed after `test-gate` passed; `release` job failed in `Validate release inputs`.
- `gh secret list -R HaoRangQi/aether-explorer` — only `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are configured.
- `security find-identity -v -p codesigning` — `0 valid identities found`.

## Release Inputs Checked

- `package.json` version: `0.4.10`
- `package-lock.json` version: `0.4.10`
- `src-tauri/tauri.conf.json` version: `0.4.10`
- `src-tauri/Cargo.toml` version: `0.4.10`
- `CHANGELOG.md` contains `## [0.4.10] - 2026-06-10`.
- `codex/06-release-runbook.md` aligned to the current four-source version gate and stable manifest validation.
- Release run failure reason: `missing APPLE_CERTIFICATE secret; updater signing is not macOS app code signing`.

## Not Covered

- Clean-user Full Disk Access acceptance remains a manual release evidence step.
- Signed macOS universal artifact creation and GitHub Release asset validation did not run because Developer ID Application signing secrets are missing.
