# Security Policy

Aether Explorer is a local-first macOS file workspace maintained as a community, non-commercial project. User file safety, local privacy, and clear failure modes take priority over feature velocity.

## Supported Versions

Security fixes target the current maintained branch and the latest GitHub Release. Older builds should be upgraded before reporting issues unless the problem is a regression in the latest version.

## Reporting a Vulnerability

Please do not open a public issue with exploit details.

Use one of these channels instead:

- GitHub private vulnerability reporting, if enabled for the repository.
- A direct maintainer message on the project repository when private reporting is unavailable.

Include:

- Aether Explorer version and macOS version.
- Installation source and whether the build was self-built or downloaded from GitHub Releases.
- Reproduction steps using a disposable test directory when possible.
- Whether the issue involves file move/copy/delete, terminal commands, extension templates, updater, external URLs, AI providers, or protected macOS directories.
- Expected impact: data loss, command execution, privacy leak, updater trust, permission bypass, or denial of service.

## Response Expectations

For credible reports, maintainers aim to:

- Acknowledge receipt within 7 days.
- Confirm severity or ask for missing reproduction details within 14 days.
- Publish a fix, mitigation, or documented non-issue once the behavior is understood.

This is a volunteer project, so these are targets rather than contractual SLAs.

## Security Boundaries

- Delete operations must move files to macOS Trash and must not silently fall back to permanent deletion.
- File operation failures should return structured, user-readable errors.
- Shell, terminal, URL, updater, and extension-template paths are treated as high-risk surfaces.
- AI provider requests may include user instructions and selected file metadata, but should not include file contents by default.
- Developer ID signing, notarization, App Store distribution, subscriptions, and enterprise features are not current roadmap blockers. The project must still describe unsigned-build risk honestly and must not present unsigned artifacts as commercial-grade trusted distribution.

## User Mitigations

- Download builds only from the project GitHub Releases.
- Test risky file operations in a disposable directory first.
- Keep backups for important folders.
- Disable custom terminal actions, URL extensions, or AI providers if unexpected behavior appears.
- Report suspected data loss or command execution issues privately before sharing public details.
