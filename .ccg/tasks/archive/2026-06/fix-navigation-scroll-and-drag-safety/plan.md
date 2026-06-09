# Plan

## Analysis

- Inspect navigation path changes and scroll state ownership.
- Inspect drag/drop paths for internal, cross-window, and Finder drops.

## Implementation

- Add regression coverage for navigation scroll reset.
- Add or extend regression coverage for drag default copy semantics.
- Reset list scroll and virtual-list offsets on directory navigation.
- Change internal Aether drag defaults from move to copy unless move is explicitly requested.

## Verification

- Focused tests for explorer view utilities/drag behavior.
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
