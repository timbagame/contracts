# Timba Contracts

Anchor-based Solana smart contracts for the Timba game platform.

## What this program does

- Runs token-based **Coinflip** and **Giveaway** games.
- Uses a commit-reveal flow for verifiable randomness.
- Requires both the game creator and current oracle operator to sign game initialization; the creator remains the fee payer.
- Keeps token allowlists, enabled state, and minimum game amounts in the off-chain Oracle service; the program validates the operator signature and positive amount.
- Derives each shared game vault from its token mint; required vault token accounts are created before a mint is enabled.
- Settles winner payouts and protocol fees directly on-chain.
- Supports legacy SPL Token flows.
- Provides timeout + oracle-buffer protections so players can recover funds if completion stalls.
- Allows the Oracle operator to close expired games only after all participants have left; giveaway funds return to the creator and only account rent goes to the operator.

For the full trust model and security details, see [SECURITY.md](./SECURITY.md).

## Repository layout

- `programs/timba/src` - on-chain program (instructions, state, events, errors).
- `programs/timba/tests` - Rust unit and LiteSVM integration test sources.
- `test-harness` - host-side `rlib` harness that compiles the same program source for Rust tests while the deployable program remains LTO-enabled.
- `tests` - Anchor/TypeScript integration tests (`anchor test`) for the generated client and validator concurrency.
- `target/idl` and `target/types` - generated artifacts committed for downstream tooling.

## Prerequisites

- Rust (`rust-toolchain.toml` pins the version)
- Solana CLI (includes `cargo-build-sbf`)
- Anchor CLI
- Node.js
- Bun

The repo also includes a `.devcontainer` for containerized setup in VS Code/Cursor/Codespaces.

## Quick start

```bash
bun install
anchor build
anchor test           # Complete Rust and TypeScript test suite
```

## Testing

| Suite                   | Command                            | Coverage                                                                                |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| **Complete suite**      | `anchor test`                      | All Rust/LiteSVM and Anchor/TypeScript tests                                            |
| **Rust / LiteSVM only** | `cargo test -p timba-test-harness` | State logic, instruction guards, fees, giveaways, oracle flows, events, and error codes |

Build the SBF binary before LiteSVM tests (loads `target/deploy/timba.so`):

```bash
cargo-build-sbf --manifest-path programs/timba/Cargo.toml
# or: anchor build
cargo test -p timba-test-harness
```

Filter examples:

```bash
cargo test -p timba-test-harness --test fees_litesvm
cargo test -p timba-test-harness unjoin
```

## Common commands

```bash
# Build program and regenerate IDL/types
anchor build

# Complete Rust and TypeScript test suite
anchor test

# Rust unit and LiteSVM tests only
cargo test -p timba-test-harness

# Formatting checks
bun run lint
bun run lint:fix

# TypeScript generated-client check
bun x tsc -p tsconfig.json --noEmit
```

## Game initialization signing flow

The oracle creates and stores the secret, then returns only its commitment hash. The creator builds an `initialize_game` transaction with itself as fee payer and sends the serialized transaction to the oracle. The oracle validates the commitment and transaction accounts, partially signs with its own key, and returns it. The creator then signs and submits the same transaction. Neither private key leaves its device.

## Mainnet deployment

Mainnet releases must use a reproducible build from a clean, public commit. Deploy the exact verifiable artifact with `--no-idl`, keep the generated IDL and types committed and synchronized with clients, and complete remote source verification afterward. Do not deploy a normal `anchor build` or `cargo-build-sbf` artifact to mainnet.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete release and verification checklist.

## Program ID

`32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`

## Additional docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) - reproducible deployment, remote verification, off-chain IDL handling, and shutdown checklist.
- [SECURITY.md](./SECURITY.md) - security model and user guidance.
- [LICENSE](./LICENSE) - Business Source License 1.1 (BUSL-1.1).
