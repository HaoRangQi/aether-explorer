# Permission Coordinator Foundation Requirements

## Objective

Move Aether Explorer closer to the MoleUI Full Disk Access model by sharing one frontend permission state/check path between startup and Settings. Do not call Gemini.

## Reference

`/Users/macos/Downloads/Projects/mole-ui/docs/macos-file-manager-fda-permission-coordinator-spec.zh-CN.md`

## Requirements

- Keep the current Full Disk Access-only model.
- Do not reintroduce Desktop/Documents/Downloads directory preflight checks.
- Avoid multiple overlapping FDA checks from startup and Settings.
- Settings must consume the shared FDA status instead of maintaining an isolated status source.
- Startup setup must update the shared status.
- Preserve the no-skip startup permission model currently implemented.
- Do not add timers, queueing, directory authorization, `tccutil reset`, Apple Events, helper/root flows, or Gemini calls.

## Evidence Needed

- Unit tests prove the shared coordinator path is wired.
- Existing permission UX tests still pass.
- TypeScript, i18n, Rust FDA, and build verification pass.
- Claude-only review is recorded for high-risk permission flow changes.
