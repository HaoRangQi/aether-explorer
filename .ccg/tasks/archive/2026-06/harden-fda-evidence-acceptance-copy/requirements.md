# Requirements

- Settings "Copy evidence" and `window.__aether.permissionEvidence()` must not produce release acceptance evidence while Full Disk Access is `denied` or `unknown`.
- Acceptance evidence must remain TCC-only and must include at least one readable FDA probe when `granted`.
- The Settings copy affordance must explain that evidence is available only after Full Disk Access is granted.
- Keep the change scoped to the FDA evidence chain; do not alter the macOS permission model or entitlement surface.
