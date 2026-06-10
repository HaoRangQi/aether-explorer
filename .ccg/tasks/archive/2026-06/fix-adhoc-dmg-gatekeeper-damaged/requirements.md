# Requirements

## User Report

- The `v0.5.0-adhoc.1` DMG opens to an app that macOS reports as damaged: `"Aether Explorer.app" 已损坏，无法打开。你应该将它移到废纸篓。`

## Scope

- Keep the release as one asset only.
- Preserve the ad-hoc/non-stable-signing disclaimer.
- Try to improve Gatekeeper behavior by generating a complete ad-hoc signed app bundle before packaging.
- Do not change stable updater release behavior.
