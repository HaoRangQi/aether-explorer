# Reveal App in Finder Permission Recovery Requirements

## Objective

Improve the Full Disk Access recovery experience by letting users locate the exact Aether app bundle/executable from Settings. This follows the MoleUI `PermissionCoordinator` Settings expectation: Open Full Disk Access Settings, Reveal App in Finder, and Check Again.

## Requirements

- Add a Settings permission action for "Reveal App in Finder".
- Add a Tauri diagnostics command that reveals the current app target in Finder.
- Packaged apps should reveal the `.app` bundle, not the nested executable.
- Dev builds may reveal the current executable if no `.app` ancestor exists.
- Keep the FDA-only model; do not add directory authorization, `tccutil reset`, Apple Events, or Gemini calls.
- Preserve existing Open System Settings and Check Again actions.

## Evidence Needed

- Failing test before implementation, then passing after implementation.
- Command is registered in `invoke_handler!`.
- i18n coverage passes.
- TypeScript, permission UX tests, Rust unit test, build, and diff checks pass.
- Claude-only review is recorded.
