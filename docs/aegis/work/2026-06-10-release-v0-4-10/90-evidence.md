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
- `git show v0.4.4:.github/workflows/release.yml` — prior working release workflow only required `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `git show v0.4.4:codex/06-release-runbook.md` — runbook release completion is defined by `.dmg`, updater package, `.sig`, `latest.json`, and remote manifest validation, not Apple Developer ID `.p12`.
- `gh workflow run release.yml -f tag_name=v0.4.10 --ref codex/remote-access` — dispatched corrected workflow run `27247626585`.
- `gh run view 27247626585 --log-failed` — `test-gate` passed, release validation passed, and `Build universal updater bundle` failed while compiling `openssl-sys v0.9.116` for `$TARGET = x86_64-apple-darwin` on `$HOST = aarch64-apple-darwin`.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i openssl-sys` — `openssl-sys -> libssh2-sys -> ssh2 -> aether-explorer`.
- `cargo info ssh2` — `ssh2` exposes `vendored-openssl = [libssh2-sys/vendored-openssl]`.
- `cargo info libssh2-sys` — `vendored-openssl = [openssl-sys/vendored]`.
- `git show v0.4.4:src-tauri/Cargo.toml` — prior working release did not include `ssh2`; the OpenSSL dependency entered with the new SFTP support in this release line.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i openssl-sys -e features` — after the fix, the feature graph includes `ssh2 feature "vendored-openssl"`, `libssh2-sys feature "vendored-openssl"`, and `openssl-sys feature "vendored"`.
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin` — passed after compiling `openssl-src`, `openssl-sys`, `libssh2-sys`, and `ssh2` for the target that failed in CI.
- `npm run lint:ci-gates` — passed and now guards `ssh2` `vendored-openssl`.
- `npm run lint` — passed.
- `npm run test:rust` — passed, 132 Rust lib tests.
- `npm run lint:rust` — passed.
- `npm test` — passed, 31 files / 369 tests.
- `npm run build` — passed.
- `npm run lint:readme` — passed.
- `npm run lint:i18n` — passed.
- `git diff --check` — passed.

## Release Inputs Checked

- `package.json` version: `0.4.10`
- `package-lock.json` version: `0.4.10`
- `src-tauri/tauri.conf.json` version: `0.4.10`
- `src-tauri/Cargo.toml` version: `0.4.10`
- `CHANGELOG.md` contains `## [0.4.10] - 2026-06-10`.
- `codex/06-release-runbook.md` aligned to the current four-source version gate and stable manifest validation.
- Release run failure reason: `missing APPLE_CERTIFICATE secret; updater signing is not macOS app code signing`.
- Corrected interpretation: that failure came from an incorrect new workflow hard gate, not from a `codex/06` release prerequisite.
- Second release run failure reason: `openssl-sys` could not discover target OpenSSL while cross-compiling the x86_64 half of the universal macOS bundle on an ARM runner.
- Corrected interpretation: the new SFTP dependency must vendor OpenSSL for universal release builds instead of relying on cross-arch pkg-config/Homebrew discovery.

## Not Covered

- Clean-user Full Disk Access acceptance remains a manual release evidence step.
- GitHub Release asset validation is pending the corrected universal build rerun.
