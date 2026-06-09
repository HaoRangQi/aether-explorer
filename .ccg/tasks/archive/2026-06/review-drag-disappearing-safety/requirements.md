# Requirements

- Re-audit the drag/drop fix after user reported that files previously disappeared from the source directory and were not visible in the target folder.
- Do not call Gemini.
- Verify code-related behavior only.
- Confirm whether current internal Aether drag paths can still invoke move operations.
- Confirm whether copy transfer backend can remove source files.
- Add stronger regression coverage if the existing tests do not directly cover the suspected loss path.
