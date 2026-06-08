# Requirements

- Do not call Gemini.
- Use `/Users/macos/Downloads/Projects/mole-ui/docs/README.zh-CN.md` as the baseline.
- Remove the backend legacy `preflight_file_permissions` command surface that probes user-content directories.
- Remove now-unused legacy directory preflight helpers, models, command registration, and tests.
- Keep `full_disk_access_status` and `register_full_disk_access` as the only permission-check commands for the current UI.
- Do not add or run `tccutil reset`.
- Do not change signing/notarization/helper/root/Admin Mode behavior.
- Verify Rust and frontend wiring tests after the removal.
