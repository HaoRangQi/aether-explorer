# Review

## Claude-Only Analysis

- Backend: Claude via `~/.claude/bin/codeagent-wrapper --backend claude`
- Finding: public docs still described the project as intentionally unsigned or treated Developer ID signing as not a blocker.
- Risk: users or releasers could treat unsigned / ad-hoc builds as stable Full Disk Access release evidence, contradicting the current validator and smoke-test gates.

## Resolution

Updated:

- `README.md`
- `README_EN.md`
- `SECURITY.md`
- `docs/PRIVACY.md`
- `docs/QUICK_DELIVERY_PLAN.md`
- `docs/RELEASE_AUDIT.md`

The new public guidance distinguishes:

- end-user install/open/FDA-grant flow,
- maintainer/tester release validation commands,
- stable non-ad-hoc signing identity as an FDA release-evidence requirement,
- notarization / App Store / commercial distribution as future or out of scope,
- unsigned / ad-hoc builds as development or advanced-user risk paths only.

## Claude-Only Review

- Backend: Claude via `~/.claude/bin/codeagent-wrapper --backend claude`
- First review:
  - Critical: none.
  - Warning: README commands were too close to the ordinary end-user flow.
  - Resolution: split README guidance into ordinary user flow and maintainer/tester release verification.
- Second review:
  - Critical: none.
  - Warning: none.
  - Result: approved; public docs are consistent with the current FDA-first release-candidate model.

## Verification

- `npm run lint:readme`: passed, 23 tracked headings match.
- `npm run lint:ci-gates`: passed, 14 script implementations verified.
- `npm run lint:macos-permissions`: passed.
- `npm run lint:i18n`: passed.
- `npm run lint`: passed.
- `npm test`: 30 files / 284 tests passed.
- `git diff --check`: passed.
- Targeted `rg` check found no old statements such as signing/notarization being non-blocking for release evidence or current builds having no Apple Developer signing.
