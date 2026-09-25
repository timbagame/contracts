# Timba contracts

On-chain programs for [Timba](https://timba.cc), a platform for multiplayer coinflips and giveaways played on the web or in Telegram.

Players stake tokens into a game, the program holds the funds, and a winner is picked from a secret that was committed before anyone joined. Anyone can recompute the winner from public data after the game settles.

| Chain  | Implementation                | Status                                                          | Docs                                                           |
| ------ | ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Solana | Rust, Anchor 1.2, SPL Token   | Mainnet, program `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5` | [README](solana/README.md), [deployment](solana/DEPLOYMENT.md) |
| EVM    | Solidity 0.8.30, UUPS, ERC-20 | Not deployed to a public network yet                            | [README](evm/README.md)                                        |

## How a game works

1. **Create.** The creator picks a token, an amount, player limits and a timeout. The Timba oracle generates a random 32-byte secret, and the game stores its SHA-256 hash as a commitment. The oracle co-signs creation, so games can only use tokens it has approved.
2. **Join.** In a coinflip every player stakes the same amount. In a giveaway the creator funds the prize and players join for free. Each wallet gets one entry.
3. **Settle.** A game is ready when it is full, or when it has reached its minimum players and its timeout has passed. The oracle then reveals the secret. The program checks it against the commitment, computes the winner, pays out and takes the fee.
4. **Recover.** If a game is still below its minimum player count at expiry, players can take their stakes back right away. A game that reached its minimum is ready instead, and if it is never settled its funds unlock after a recovery buffer, so they cannot be stuck behind the oracle.

### Winner selection

On Solana the winner comes from `sha256(secret || final_slot)`, read as little-endian u64 values with rejection sampling so every entry is equally likely. The EVM contract uses a domain-separated Keccak formula over the chain ID, contract address, game ID, secret and last entry block. Both avoid modulo bias and revert rather than fall back to a biased pick.

To check a result yourself, use [`@timbagame/protocol`](https://github.com/timbagame/protocol), which implements the same calculations, or the verifier at [timba.cc/provably-fair](https://timba.cc/provably-fair).

### Limits

| Setting       | Contract ceiling       |
| ------------- | ---------------------- |
| Game duration | 30 days                |
| Oracle buffer | 1 day                  |
| Fee           | 10%, whole percentages |

The live fee and buffer are configured on-chain within these ceilings. Timba currently charges 1%.

## Trust model

Read this before you rely on the contracts:

- **The oracle is trusted.** It knows each secret before settlement, approves game creation and private entries, and can decline to reveal. Commit-reveal stops the secret from changing after players join, but it does not make games fair against a malicious oracle or block producer. There is no external VRF.
- **The contracts are upgradeable.** Whoever holds the upgrade authority controls program behavior and the escrowed funds.
- **Token policy is off-chain.** The oracle decides which tokens and minimum amounts it will sign for. The Solana program accepts only legacy SPL Token mints, and the EVM contract rejects fee-on-transfer behavior.
- **Tests are not an audit.** The test suites are extensive, but they are not an independent security audit.

Full details: [SECURITY.md](SECURITY.md), [Solana security model](solana/SECURITY.md), [EVM security model](evm/SECURITY.md).

## Repository layout

```text
solana/     Anchor program, Rust and LiteSVM tests, generated Kit client
evm/        Solidity contract, Foundry tests, deployment scripts, exported ABI
fixtures/   Shared lifecycle and fee cases both implementations must pass
```

Each project has its own dependencies, pinned toolchain and CI workflow. There is no shared build.

## Build and test

### Solana

Requires Rust 1.98.1, Solana CLI 4.2.2, Anchor CLI 1.2.0 and [Bun](https://bun.sh) 1.4.2.

```bash
cd solana
solana-keygen new --no-bip39-passphrase --outfile ~/.config/solana/id.json  # skip if you already have one
bun install --frozen-lockfile
anchor build --ignore-keys
anchor test --skip-build
```

Mainnet releases use a verifiable build. [solana/DEPLOYMENT.md](solana/DEPLOYMENT.md) explains how to reproduce the deployed executable hash with `solana-verify`.

### EVM

Requires Foundry 1.8.1, plus [Bun](https://bun.sh) for the smoke test. Dependencies are git submodules.

```bash
git submodule update --init --recursive
cd evm
forge build
forge test
bash script/local-smoke.sh
```

The smoke test runs a full coinflip on a local Anvil node.

### Shared fixtures

[fixtures/lifecycle.csv](fixtures/README.md) holds 180 cases covering both game types, player counts, expiry and buffer boundaries, and fee rounding. The Rust, LiteSVM and Foundry suites all run the same file, so both chains follow the same rules.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through this repository's [Security tab](https://github.com/timbagame/contracts/security/advisories/new). Never post unrevealed secrets or private keys.

## Related

- [timbagame/protocol](https://github.com/timbagame/protocol): TypeScript clients, IDLs, ABIs and winner verification
- [timba.cc](https://timba.cc): play on the web and verify games
- [@playtimbabot](https://t.me/playtimbabot): play in Telegram
