# Timba Contracts

Timba Contracts is an Anchor program for token-based coinflip and giveaway games on Solana.

The current branch targets v0.3.0. This release removes `GameToken` accounts and changes the instruction and client interfaces while preserving the v0.2 `Oracle` and `Game` account layouts. Read [DEPLOYMENT.md](./DEPLOYMENT.md) before upgrading an existing deployment.

Program ID: `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`

## Program model

The program uses three main address types:

| Address         | Derivation                   | Purpose                                                                   |
| --------------- | ---------------------------- | ------------------------------------------------------------------------- |
| Oracle          | `["oracle"]`                 | Stores the operator, fee configuration, timeout limits, and oracle buffer |
| Game            | `["game", random_hash]`      | Stores one game and binds it to its commitment hash                       |
| Vault authority | `["game_vault", token_mint]` | Controls the shared vault token account for one mint                      |

The vault token account is the canonical associated token account for the mint-derived vault authority. It must exist before the program uses that mint. All games for the same mint share this vault, while each `Game` account tracks its own balance and participants.

Only the legacy SPL Token program is supported. Token-2022 mints are rejected by the account constraints.

## Game lifecycle

1. The oracle service generates a 32-byte secret and its SHA-256 commitment.
2. The creator and current oracle operator sign `initialize_game`. The creator pays account rent and funds the prize for a giveaway.
3. Players call `join_game`. A private game also requires the current oracle operator to sign each join.
4. A game becomes ready when it is full, or when its minimum ticket count is met and its timeout has elapsed.
5. Once the game is ready and before its recovery boundary, the oracle operator reveals the secret through `complete_game`. The program verifies the commitment, recomputes the winner, transfers the payout and fee, and closes the game account.
6. A join is committed until the game timeout. At timeout, an underfilled game unlocks immediately. A ready game unlocks only at the recovery boundary: `created_at + timeout + current_oracle_buffer_time`. This boundary is not calculated from when the game fills. See [SECURITY.md](./SECURITY.md).

The oracle signature authorizes game creation but does not make creation policy on-chain. Token enablement, allowlists, and minimum amounts remain in the off-chain service. The program enforces a positive amount and the configured on-chain limits.

## Instructions

| Instruction           | Required authority                                | Purpose                                                      |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `initialize_oracle`   | Intended operator and program upgrade authority   | Creates the global Oracle PDA                                |
| `update_oracle`       | Current and new operators                         | Updates configuration and optionally rotates the operator    |
| `initialize_game`     | Creator and current operator                      | Creates a game from an approved commitment                   |
| `join_game`           | Player; current operator also signs private joins | Adds one unique participant                                  |
| `unjoin_game`         | Participant or game creator                       | Removes a participant and refunds a coinflip stake           |
| `complete_game`       | Current operator                                  | Reveals the secret and settles the game                      |
| `close_game`          | Game creator                                      | Closes an eligible game and refunds an unused giveaway prize |
| `operator_close_game` | Current operator                                  | Cleans up an expired, empty game                             |
| `close_oracle`        | Current operator and program upgrade authority    | Closes the current Oracle account                            |

## Repository layout

- `programs/timba/src` contains the on-chain program.
- `programs/timba/tests` contains Rust unit and LiteSVM integration tests.
- `test-harness` compiles the program as a host-side library for Rust tests.
- `tests` contains Kit integration tests and the Codama-generated v0.3 client.
- `target/idl/timba.json`, `target/types/timba.ts`, and `tests/generated` are committed generated artifacts.
- `.github/workflows/ci.yml` defines the supported CI toolchain.

## Toolchain

The repository pins or tests these versions:

- Rust 1.98.1
- Solana CLI 4.2.2
- Anchor CLI 1.2.0
- Bun 1.4.1
- Surfpool 1.5.0 (verify `surfpool --version`; 1.4.0 failed to execute the upgraded program)

Use `rust-toolchain.toml`, `Anchor.toml`, and `.github/workflows/ci.yml` as the version sources of truth.

## Local setup

Create a local Solana keypair if one does not exist:

```bash
solana-keygen new \
  --no-bip39-passphrase \
  --outfile ~/.config/solana/id.json
```

Install dependencies, build the program, and run the complete suite:

```bash
bun install --frozen-lockfile
anchor build --ignore-keys
anchor test --skip-build
```

The repository also includes a development-container configuration. Its installer is intended for local development; release builds must use the pinned release process in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Testing and checks

| Check                              | Command                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| Complete Rust and TypeScript suite | `anchor test`                                           |
| Rust and LiteSVM suite             | `cargo test -p timba-test-harness`                      |
| Rust formatting                    | `cargo fmt --all -- --check`                            |
| Rust lint                          | `cargo clippy --workspace --all-targets -- -D warnings` |
| Markdown and TypeScript formatting | `bun run format:check`                                  |
| TypeScript lint                    | `bun run lint`                                          |
| TypeScript type check              | `bun run typecheck`                                     |
| Generated Kit client drift         | `bun run check:generated`                               |
| JavaScript dependency audit        | `bun audit`                                             |

LiteSVM tests load `target/deploy/timba.so`. Build it before running the Rust-only suite:

```bash
anchor build --ignore-keys
cargo test -p timba-test-harness
```

To run a focused Rust test:

```bash
cargo test -p timba-test-harness --test fees_litesvm
cargo test -p timba-test-harness unjoin
```

After changing the program interface, rebuild and commit the IDL, Anchor types, and Kit client:

```bash
anchor build --ignore-keys
bun run generate:client
git diff -- target/idl/timba.json target/types/timba.ts tests/generated
```

## Security and deployment

- [SECURITY.md](./SECURITY.md) defines the trust model, authority boundaries, recovery rules, and known risks.
- [DEPLOYMENT.md](./DEPLOYMENT.md) defines the v0.3.0 migration and reproducible mainnet release process.

## License

This repository uses the [Business Source License 1.1](./LICENSE).

## Cross-repository integration

The shared local-validator suite lives in the sibling `operations/integration` directory. Run `bun run test:integration --web` from `operations`; see its README for pinned toolchains, candidate protocol packages and optional manual GitHub runs. Normal CI does not run the combined system suite or require a cross-repository credential.
