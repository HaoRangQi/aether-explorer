# Requirements

Build a local production macOS bundle so the user can test Full Disk Access behavior outside `tauri dev`.

## Scope

- Produce local `.app` and preferably `.dmg` artifacts.
- Do not run the full GitHub release script.
- Do not upload assets.
- Do not handle manual FDA acceptance, clean-user evidence, certificates, notarization, or release proof.
- Do not call Gemini.

## Build Choice

Use `tauri build` with updater artifact generation disabled for this local test package, because full release signing/upload is outside the request.
