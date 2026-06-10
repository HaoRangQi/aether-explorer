# Requirements

## User Report

- The old local release candidate `/Users/macos/Downloads/Projects/aether-explorer/src-tauri/target/release/bundle/dmg/Aether Explorer_0.4.4_aarch64.dmg` does not trigger the current access problem.
- The current formal release triggers a macOS prompt asking `Aether Explorer.app` to access the `Downloads` folder even though Full Disk Access appears enabled in System Settings.

## Scope

- Diagnose the difference between the working 0.4.4 app bundle and the current formal release bundle.
- Fix only code/config/build issues related to packaged macOS app identity, permission model, and release validation.
- Do not require or automate manual Full Disk Access acceptance.
- Do not change unrelated explorer behavior.

## Success Evidence

- Root cause is tied to concrete bundle/signature/config evidence.
- Release/package validation catches the regression locally or in CI.
- Relevant tests/lints pass.
