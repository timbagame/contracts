# Timba contracts

Coinflip and giveaway contracts for Solana and EVM networks.

| Project                    | Implementation           | Build and test     | Deployment                                 |
| -------------------------- | ------------------------ | ------------------ | ------------------------------------------ |
| [Solana](solana/README.md) | Rust / Anchor, SPL Token | Anchor and LiteSVM | [Solana deployment](solana/DEPLOYMENT.md)  |
| [EVM](evm/README.md)       | Solidity / UUPS, ERC-20  | Foundry and Anvil  | [EVM deployment](evm/README.md#deployment) |

Each project owns its dependencies, pinned toolchains, generated interfaces and
deployment process. Run project commands from its directory. No shared runtime
or package installation is required.

## Shared game rules

- Coinflips pool equal stakes; giveaways use a creator-funded prize.
- Each wallet has one entry per game.
- The Oracle authorizes creation and private entries, commits to a secret, then reveals it to settle.
- Full games are ready immediately; other games need their minimum entries and expiry.
- Underfilled games allow recovery at expiry; ready games allow recovery after the live Oracle buffer.
- Contract ceilings are 30 days for game duration, one day for the buffer, and a 10% fee.
- Token policy stays off-chain. Winner calculation and transaction authorization remain chain-specific.

See [SECURITY.md](SECURITY.md) for shared trust assumptions and each project's
documentation for its authority, storage and token restrictions.

## Development

```bash
# Solana
cd solana
bun install --frozen-lockfile
anchor build --ignore-keys
cargo test -p timba-test-harness
```

```bash
# EVM, starting from the repository root
git submodule update --init --recursive
cd evm
forge build
forge test
bash script/local-smoke.sh
```

[Shared fixtures](fixtures/README.md) exercise the same lifecycle and fee rules
on both implementations. Solana changes run Solana CI; EVM changes run EVM CI;
fixture changes run both. Root documentation changes do not trigger full builds.

## License

[Business Source License 1.1](LICENSE).
