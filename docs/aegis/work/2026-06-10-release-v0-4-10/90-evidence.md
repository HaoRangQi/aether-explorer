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
- `git commit -m "fix: vendor openssl for universal release builds"` — created `33fed26`.
- `git push origin codex/remote-access` — pushed `33fed26`.
- `git tag -f v0.4.10 HEAD && git push --force origin v0.4.10` — moved the incomplete release tag from `80369ed` to `33fed26` so workflow checkout builds the corrected dependency declaration.
- `gh run watch 27248872308 --exit-status` — passed; `test-gate` completed in 3m46s and `release` completed in 12m08s.
- `gh release view v0.4.10 -R HaoRangQi/aether-explorer --json isDraft,isPrerelease,assets,url` with the `codex/06` asset predicate — passed.
- `curl -fsSL https://github.com/HaoRangQi/aether-explorer/releases/download/v0.4.10/latest.json | jq ...` — passed; both `darwin-aarch64` and `darwin-x86_64` signatures are present and point at the `v0.4.10` updater package.
- `curl -fsSL https://github.com/HaoRangQi/aether-explorer/releases/download/stable/latest.json | jq ...` — passed; stable manifest version is `0.4.10`.
- `curl -fsSL https://github.com/HaoRangQi/aether-explorer/releases/download/v0.4.10/SHA256SUMS | grep -E ...` — passed; checksums include the universal `.dmg`, updater `.app.tar.gz`, `.sig`, and `latest.json`.
- `gh release view v0.4.10 -R HaoRangQi/aether-explorer --json name,url,body,assets` — release notes are sourced from `CHANGELOG.md` and explicitly describe changes compared with `v0.4.4`.

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

- Clean-user Full Disk Access acceptance remains intentionally out of scope for this code-only release task.
