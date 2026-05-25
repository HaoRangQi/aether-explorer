# Contributing to Aether Explorer

Aether Explorer is a local-first, community-maintained, non-commercial macOS file workspace. Contributions should protect user files first and keep the product honest about unfinished or risky behavior.

## Principles

- User data safety beats feature speed.
- Local-first behavior is the default; new outbound requests must be explicit and documented.
- File move, copy, delete, terminal, updater, and AI-provider changes need extra review.
- Small, focused pull requests are easier to validate.
- Do not add subscriptions, enterprise-only flows, App Store assumptions, or Developer ID / notarization as blocking roadmap requirements.

## Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the Tauri desktop app:

```bash
npm run tauri dev
```

Useful checks before opening a PR:

```bash
npm run lint
npm test
npm run test:rust
npm run build
bash -n scripts/release.sh
git diff --check
```

If a check cannot run in your environment, state that clearly in the PR.

## Documentation Rules

- User-visible behavior changes should update `README.md`, `README_EN.md`, `FEATURES.md`, or `TODO.md` as appropriate.
- New outbound requests or privacy-sensitive data flow must update `docs/PRIVACY.md`.
- Release, updater, file-operation, or security-risk changes should update `docs/RELEASE_AUDIT.md`.
- Public-facing release changes should update `CHANGELOG.md`.
- Keep Chinese and English README content aligned where both mention the same behavior.

## Pull Request Checklist

- Describe the user problem and the chosen fix.
- List the files or modules touched.
- Include test results.
- Call out residual risk, especially for file operations.
- Do not commit local secrets, generated release bundles, personal settings, or unrelated workspace changes.

## Issues

Bug reports should include:

- Aether Explorer version.
- macOS version and CPU architecture.
- Installation source.
- Reproduction steps.
- Expected and actual behavior.
- Whether the path is a protected directory, external volume, network volume, or symlink.
- Relevant logs or screenshots when safe to share.

Feature requests should explain:

- The user workflow.
- Why the feature fits local-first, community distribution.
- Privacy, data-loss, or maintenance risks.

Security reports should follow `SECURITY.md` and avoid public exploit details.
