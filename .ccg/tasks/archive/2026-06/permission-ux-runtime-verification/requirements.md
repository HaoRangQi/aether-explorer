# Runtime Permission UX Verification Requirements

## Objective

Continue the Full Disk Access permission UX work without calling Gemini. Verify that the implemented code is not only unit-tested, but also reasonable for a real Tauri/macOS runtime path.

## Evidence Needed

- Tauri/Rust command registration compiles.
- Frontend permission UI renders without blocking web preview.
- The startup flow only runs in Tauri runtime.
- The FDA command path uses TCC-only probes.
- Any inability to prove clean-machine TCC behavior is recorded explicitly.

## Non-goals

- Do not call Gemini.
- Do not reset local TCC permissions automatically.
- Do not perform destructive `tccutil reset`.
- Do not widen scope into release signing or helper-process redesign.
