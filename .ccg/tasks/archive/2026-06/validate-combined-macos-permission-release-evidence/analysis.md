# Analysis

- User constraint: do not call Gemini.
- Existing gates validate two separate artifacts:
  - `validate:macos-app:release` validates release-stable signed `.app` metadata/signing.
  - `validate:fda-evidence` validates clean-user FDA evidence JSON shape/status/probes.
- Gap: the two commands can be run against different app paths or versions; current automation does not prove the FDA evidence belongs to the same release candidate.

## Claude-Only Analysis

- Claude recommended a Node orchestrator that delegates to both existing validators, then compares evidence `appIdentity` against the `.app` bundle identity.
- The combined validator proves consistency, not authenticity. The evidence must still be captured from a clean-user FDA acceptance run.
- Release pipelines should not run this command automatically because clean-user FDA evidence is a separate human/environment gate.

## TDD

- Mode: auto
- Decision: strict
- Reason: release evidence gates must fail closed when app/evidence identity drift occurs.

## Pre-Edit Complexity Check

- Target edit file: new `scripts/validate-macos-permission-release-evidence.mjs`
- Existing pressure signal: separate validators remain focused; orchestration belongs in a new owner file.
- Owner fit: new script owns cross-artifact consistency only.
- Safer edit boundary: delegate existing validation instead of duplicating FDA/app validator logic.
- Decision: add owner file
