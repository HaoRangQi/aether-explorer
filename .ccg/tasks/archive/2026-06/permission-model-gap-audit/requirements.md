# Requirements

- Do not call Gemini.
- Use `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` as the permission model baseline.
- Audit the current Aether permission implementation against the MoleUI requirements.
- Prefer one concrete, bounded improvement that moves the project closer to:
  - one manual Full Disk Access setup,
  - real probe as source of truth,
  - no directory-level authorization fallback in core paths,
  - unified recovery only when FDA is missing,
  - no extra privacy-domain noise,
  - no destructive TCC reset.
- Do not run `tccutil reset` or any destructive macOS permission command.
- Do not expand into signing/notarization/helper/root/Admin Mode unless the audit only documents it as a future risk.
- If code changes are needed, keep them narrowly scoped and verify with tests/lints.
