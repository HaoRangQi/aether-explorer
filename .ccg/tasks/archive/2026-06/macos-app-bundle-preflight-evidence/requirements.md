# Requirements

- Do not call Gemini.
- Follow `.ccg/spec/guides/index.md`.
- Generate or locate a packaged macOS `.app` for the current worktree.
- Run `npm run validate:macos-app -- /path/to/Aether\ Explorer.app` against that `.app`.
- Do not run `tccutil reset`, mutate TCC, or claim Full Disk Access is granted.
- Record whether this closes only the packaged-bundle preflight or exposes remaining clean-user FDA evidence work.
