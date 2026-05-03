## Working Rules

- Read before editing, reproduce before fixing runtime/external issues, and test before declaring done.
- Prefer small edits over rewrites; choose the simplest working solution without speculative features or single-use abstractions.
- Explain only non-obvious logic; avoid filler, boilerplate, and out-of-scope suggestions.
- Keep imports at the top unless a local import is strictly required; remove unused imports, variables, parameters, dead branches, and replaced code from edited files.
- Do not add error handling for impossible scenarios, compatibility shims, or feature flags for shipped behavior without explicit authorization.
- Code and comments stay in English; user-facing strings keep their existing language.
- Prove debugging claims with direct evidence: a failing test, reproduced run, or concrete probe. Unproven concerns are risks, not bugs.
- Use the standard toolchain for verification; no "fixed/safe/ready" claims without fresh command output.
- Run tests before committing or declaring work complete when project tests exist; treat failing tests as blocking unless explicitly documented as pre-existing.
- Ask before pushing every time. Do not batch commit+push, force push, hard reset, or `git commit --amend` without explicit approval.
- Merge to `main` with a single squashed commit; commit messages in English.
- Use environment variables only for secrets and external credentials; prefer sane defaults and zero-config maintenance.
- Verify dependency versions from the registry or official source before adding/updating dependencies.
- Use plain hyphens and straight quotes; keep code output copy-paste safe.

## Project Shape

- Anchor/Solana contracts repo only; client services live in sibling `../bot` and `../oracle` repos.
- Single Anchor program: `programs/timba/src/lib.rs`, program ID `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5` for localnet/devnet/mainnet.
- Instruction handlers are one file per instruction under `programs/timba/src/instructions/`; shared account structs are in `instructions/accounts.rs`.
- `OracleConfig`, `TokenConfig`, and `GameConfig` are defined in `lib.rs`, while account state and PDA seed constants are in `state.rs`.
- SPL Token and Token-2022 are both supported; use token interfaces and keep `token_2022` feature support intact.

## Commands

- Install deps with `bun install`; `Anchor.toml` sets `package_manager = "bun"`, so do not switch to npm/yarn commands.
- Build and regenerate committed IDL/types with `anchor build`.
- Run the full local suite with `anchor test`; Anchor still manages build/validator lifecycle, then runs `bun run ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'`.
- Run a focused TS test with `bun run ts-mocha -p ./tsconfig.json -t 1000000 tests/<file>.test.ts` only when you already have a validator/build context or do not need Anchor's lifecycle.
- Run TS checks with `bun run typecheck`; CI currently does this only and does not run `anchor build` or `anchor test`.
- Run formatting checks with `bun run lint`; fix JS/TS formatting with `bun run lint:fix`.
- After changing the IDL surface, run `anchor build` then `bun run update-idl` to copy `target/idl/timba.json` and `target/types/timba.ts` to `../bot/idl/` and `../oracle/idl/`.

## Generated Artifacts

- `target/idl/timba.json` and `target/types/timba.ts` are intentionally committed for downstream consumers; do not delete them as build output.
- The root `types/`/`idls/` paths are not the source of truth; generated Anchor artifacts live under `target/`.
- Program defaults in `programs/timba/Cargo.toml` include `no-idl` and `no-log-ix-name`; preserve `idl-build` features when touching IDL generation.

## Testing Notes

- Tests share `tests/test-helpers.ts`, including the `TestEnvironment` singleton and deterministic oracle operator keypair from `Uint8Array(32).fill(42)`.
- Many tests depend on Solana clock/buffer behavior; use helpers such as `awaitBufferExpiry` and `awaitOracleCompletionReady` instead of ad hoc sleeps when possible.
- Some race and capacity tests intentionally have long timeouts (`120000`-`180000` ms); do not shorten them without proving the timing remains reliable.
- `fast-check` is used for winner-index property testing; keep property tests focused on pure helpers when possible.

## Contract Semantics To Preserve

- Core games are Coinflip and Giveaway, with commit-reveal randomness plus slot entropy; the oracle completes games but buffer unjoin lets players recover after timeout + buffer.
- `_random_hash` instruction parameters may look unused in Rust handlers because Anchor uses them in account seed constraints; do not remove or rename them casually.
- Game accounts close on completion, so post-completion fetches should expect missing accounts.
- Participant tracking uses first 8 bytes of `SHA256("timba:part:v1" || game_key || player_pubkey)`; keep domain/version compatibility unless intentionally migrating state.
- Release profile disables overflow checks by design for compute budget; use explicit checked arithmetic where overflow matters.
- Error codes are grouped by range in `error.rs`; preserve the existing organization when adding errors.

## Deployment And Ops

- Mainnet flow is documented in `MAINNET_DEPLOYMENT.md`; do not infer deployment steps from Anchor defaults.
- `anchor deploy --no-idl` is the documented deploy command; `anchor migrate` runs `migrations/deploy.ts`.
- `ORACLE_OPERATOR_KEYPAIR_PATH` controls the oracle operator during migration; without it, the deployer wallet becomes operator.
- Anchor is pinned to `0.32.1`; the custom `[registry] url = "https://api.apr.dev"` is valid for this version but is not Anchor 1.0-compatible.

## Existing Guidance

- `CLAUDE.md` only references this file via `@AGENTS.md`; there is no separate Claude-specific policy to merge.
- `SECURITY.md` is the source for the trust model and user-facing security claims; verify against it before changing game, oracle, fee, or timeout behavior.
