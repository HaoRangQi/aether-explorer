# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Strengthen `validate:macos-app:release` so ad-hoc signatures or signatures without a stable TeamIdentifier cannot pass as Full Disk Access release evidence.
- Release-candidate mode must require the code-signing identifier to match `com.aether.explorer`.
- Release-candidate mode must reject `Signature=adhoc`, `TeamIdentifier=not set`, or missing TeamIdentifier.
- Default `validate:macos-app` behavior must remain warning-only for unsigned local/dev bundles.
- Add focused tests for stable signing identity, ad-hoc rejection, missing TeamIdentifier, and signing identifier mismatch.
- Do not run `tccutil reset`, mutate TCC, or claim Full Disk Access is granted.
