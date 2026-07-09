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
- `tests` - integration and behavior tests (`anchor test` runner).
- `scripts/update-idl.ts` - copies generated IDL/types to sibling consumers.
- `target/idl` and `target/types` - generated artifacts committed for downstream tooling.

## Prerequisites

- Rust
- Solana CLI
- Anchor CLI
- Node.js
- Bun

The repo also includes a `.devcontainer` for containerized setup in VS Code/Cursor/Codespaces.

## Quick start

```bash
bun install
anchor build
anchor test
```

## Common commands

```bash
# Build program and regenerate IDL/types
anchor build

# Run full test suite
anchor test

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
