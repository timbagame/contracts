# Repository Guidelines

## Project Structure & Module Organization
- programs/coinflip/src: Rust/Anchor program (lib.rs, state.rs, error.rs, events.rs, instructions/).
- tests: TypeScript test suites run via Anchor + ts-mocha (e.g., core.test.ts, security.test.ts).
- scripts: Dev helpers (setup-local.ts, update-idl.ts).
- migrations, .anchor, target: Anchor artifacts (IDL in target/idl, generated types in target/types).
- Anchor.toml: Program IDs, provider, and test runner config.

## Build, Test, and Development Commands
- Build: `anchor build` — compiles the on-chain program and regenerates IDL/types.
- Test: `anchor test` — runs ts-mocha with config from `Anchor.toml` against `tests/**/*.test.ts`.
- Local setup: `yarn run setup-local` — funds accounts and initializes oracle/token on localnet.
- Sync IDL: `yarn run update-idl` — copies `target/idl` and `target/types` to sibling consumers.

## Coding Style & Naming Conventions
- Rust: follow rustfmt defaults (snake_case modules/functions, CamelCase types). Prefer small, focused instruction handlers under `instructions/`. Run `cargo fmt` locally before committing.
- TypeScript: Prettier with 2-space indent. Run `yarn run lint` (check) and `yarn run lint:fix` (write). Use camelCase for variables/functions and PascalCase for types.
- Files: tests as `*.test.ts`; instruction files as verb_noun.rs (e.g., `initialize_oracle.rs`).

## Testing Guidelines
- Framework: ts-mocha + chai configured via `Anchor.toml`.
- Scope: keep unit-like helpers in `tests/test-helpers.ts`; add scenario tests alongside existing suites (core, security, game-types, edge-cases, advanced).
- Run: `anchor test`. Long timeouts are preconfigured; avoid adding `.only` in committed tests.

## Commit & Pull Request Guidelines
- Commits: imperative, clear summaries (e.g., “Refactor player games initialization; simplify filter checks”). Group related changes; avoid noisy reformat-only commits.
- PRs: include description, rationale, and links to issues; list commands run (`anchor build`, `anchor test`), and any state migrations. Attach logs or screenshots for notable behavior changes.
- Requirements: updated docs when touching program IDs, instruction interfaces, or security-sensitive logic (see `SECURITY.md`).

## Security & Configuration Tips
- Program IDs and cluster/wallet are set in `Anchor.toml` (`[provider]`). Do not commit private keys. For non-local clusters, verify PDAs and addresses before deploy (`anchor deploy`).
