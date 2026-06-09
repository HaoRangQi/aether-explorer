# Requirements

- Do not call Gemini; use Claude-only review.
- Preserve current FDA recovery behavior; this task changes user-facing copy only.
- Ensure the actual English and Chinese locale values for Explorer permission recovery explain:
  - macOS privacy protection.
  - Stable app identity / install-path drift as a reason permissions can appear to fail repeatedly.
  - A clear retry path through System Settings and the exact Aether Explorer app target.
- Avoid relying on `t()` fallback strings for important recovery guidance.
- Add source-level guardrails proving the actionable locale copy exists.
- Keep clean-user FDA release evidence as the remaining external acceptance gap.

