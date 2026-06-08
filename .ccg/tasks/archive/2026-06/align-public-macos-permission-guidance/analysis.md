# Analysis

## Scope

Public-facing documentation was audited for stale macOS permission and signing guidance:

- `README.md`
- `README_EN.md`
- `docs/PRIVACY.md`
- `docs/QUICK_DELIVERY_PLAN.md`
- `docs/RELEASE_AUDIT.md`
- `SECURITY.md`

## Findings

- The current permission spec requires release-candidate FDA evidence to use a stable non-ad-hoc signing identity with `TeamIdentifier` and code-signing `Identifier=com.aether.explorer`.
- README and supporting docs still described Developer ID signing as not a roadmap blocker or presented the project as effectively unsigned.
- That wording conflicted with the validator and smoke-test evidence chain, and could lead users or releasers to treat unsigned / ad-hoc builds as valid Full Disk Access release evidence.

## Claude-Only Analysis

- Claude confirmed the conflict in README, README_EN, SECURITY, PRIVACY, QUICK_DELIVERY_PLAN, and RELEASE_AUDIT checklist wording.
- Important refinement: do not overstate notarization or commercial distribution requirements; stable signing identity is the requirement for FDA evidence.

## Implementation Decision

- Update public docs to say:
  - stable signing identity is required for macOS FDA release-candidate evidence,
  - unsigned / ad-hoc builds are only development or advanced-user risk paths,
  - notarization, App Store, subscriptions, and enterprise distribution remain future/non-goals,
  - no document should package unsigned / ad-hoc artifacts as stable Full Disk Access evidence.
