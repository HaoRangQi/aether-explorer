# Requirements

Add a user custom theme palette group to the appearance settings shown in the screenshot.

## Scope

- Use `Apple Braille` as the default base font.
- Let users name and save the current accent color plus detailed color controls as a custom preset.
- Show saved user presets as a separate custom group near curated palettes.
- Applying a custom preset restores the saved accent and detailed colors.
- Let users delete saved custom presets.
- Keep presets in the existing theme settings persistence and backup/import path.

## Non-Goals

- Do not change macOS permission behavior.
- Do not perform manual acceptance testing.
- Do not call Gemini.

## TDD Route

- Mode: auto
- Decision: strict
- Reason: user-visible settings behavior plus persistence/import contract changes.
- Verification: targeted settings tests first, then lint/type checks.
