# Plan

1. Continue Rust lib.rs extraction with commands/transfer.rs.
2. Update app state management and invoke_handler paths without changing command names.
3. Update tests to import transfer internals via pub(crate) only where needed.
4. Run npm run test:rust and npm run lint:rust.
5. Reassess next slice after stable transfer extraction.
