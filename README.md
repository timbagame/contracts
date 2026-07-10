# Timba Contracts

Anchor-based Solana smart contracts for the Timba game platform.

## What this program does

- Runs token-based **Coinflip** and **Giveaway** games.
- Uses a commit-reveal flow for verifiable randomness.
- Settles payouts on-chain and accrues protocol fees per token config.
- Supports both SPL Token and Token-2022 flows.
- Provides timeout + oracle-buffer protections so players can recover funds if completion stalls.

For the full trust model and security details, see [SECURITY.md](./SECURITY.md).

## Repository layout

- `programs/timba/src` - on-chain program (instructions, state, events, errors).
- `programs/timba/tests` - Rust unit and LiteSVM integration tests (`cargo test`).
- `tests` - Anchor/TypeScript integration tests (`anchor test`) for the generated client, validator concurrency, and token compatibility.
- `scripts/update-idl.ts` - copies generated IDL/types to sibling consumers.
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

| Suite | Command | Coverage |
|-------|---------|----------|
| **Complete suite** | `anchor test` | All Rust/LiteSVM and Anchor/TypeScript tests |
| **Rust / LiteSVM only** | `cargo test -p timba` | State logic, instruction guards, fees, giveaways, oracle flows, events, and error codes |

Build the SBF binary before LiteSVM tests (loads `target/deploy/timba.so`):

```bash
cargo-build-sbf --manifest-path programs/timba/Cargo.toml
# or: anchor build
cargo test -p timba
```

Filter examples:

```bash
cargo test -p timba --test fees_litesvm
cargo test -p timba unjoin
```

## Common commands

```bash
# Build program and regenerate IDL/types
anchor build

# Complete Rust and TypeScript test suite
anchor test

# Rust unit and LiteSVM tests only
cargo test -p timba

# Sync generated IDL/types to sibling repos
bun run update-idl

# Formatting checks
bun run lint
bun run lint:fix
```

## Program ID

`32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`

## Additional docs

- [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md) - deployment and shutdown checklist.
- [SECURITY.md](./SECURITY.md) - security model and user guidance.
- [LICENSE](./LICENSE) - Business Source License 1.1 (BUSL-1.1).
