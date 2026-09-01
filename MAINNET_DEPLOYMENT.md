# Timba Contracts — Mainnet Release Guide

This public guide covers contract release requirements. Production service rollout, operator key custody, host configuration, incident recovery, and cross-project orchestration belong in private operations documentation.

Program ID:

```text
32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5
```

## Toolchain

Use the versions pinned by the repository:

- Anchor CLI 1.1.2
- Solana CLI 3.1.10
- Bun 1.3.14
- `solana-verify`
- A container runtime supported by Anchor verifiable builds

Release from a clean public commit. Generated `target/idl/timba.json` and `target/types/timba.ts` must match that commit.

## Compatibility gate

Version 0.3.0 is a coordinated breaking migration. Its `Oracle` and `Game` layouts
are not compatible with 0.2.x, and it removes `GameToken` accounts. Before deployment:

1. Stop new game creation.
2. Settle or close every existing game.
3. Withdraw all accrued 0.2.x fees.
4. Close every obsolete `GameToken` account and its empty vault where required.
5. Create and verify each v0.3 mint-derived vault ATA and fee-recipient ATA.
6. Deploy matching program, IDL, and client releases before re-enabling creation.

An executable upgrade does not resize or rewrite program-owned accounts. Do not
upgrade the existing program address until the Oracle migration mechanism is
documented and tested. If v0.3 uses a new program address, update the declared ID,
deployment configuration, generated artifacts, and every downstream client as one
release.

## Test and freeze

```bash
bun install --frozen-lockfile
anchor test
bun run format:check
bun run lint
bun run typecheck
git diff --exit-code
git diff --cached --exit-code
```

Record the exact public commit used for the release:

```bash
git rev-parse HEAD
```

## Reproducible build

```bash
anchor build --verifiable --solana-version 3.1.10
solana-verify get-executable-hash target/verifiable/timba.so
```

Do not substitute `target/deploy/timba.so` for the verifiable artifact in a production release. Record the executable and IDL hashes before deployment.

## Deploy

Confirm the target cluster, program ID, current upgrade authority, expected balance impact, and executable hash before signing. Upgrade the existing program ID; never generate a replacement program for a routine upgrade.

Deploy with `--no-idl`. The canonical generated IDL stays off-chain to avoid creating a rent-funded IDL account:

```bash
anchor deploy \
  --verifiable \
  --no-idl \
  --program-name timba \
  --provider.cluster mainnet \
  --provider.wallet <UPGRADE_AUTHORITY_KEYPAIR>
```

Dump the deployed executable and require its hash to match the frozen verifiable artifact before continuing.

## Keep the IDL off-chain

Do not run `anchor idl init` or `anchor idl upgrade`. Keep `target/idl/timba.json` and `target/types/timba.ts` committed, hash the generated IDL as release evidence, and require downstream clients to bundle the identical artifact.

## Verify source

Verify the deployed executable against the exact public commit:

```bash
solana-verify verify-from-repo \
  -u https://api.mainnet-beta.solana.com \
  --program-id 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  https://github.com/timbagame/contracts \
  --commit-hash <COMMIT_SHA> \
  --library-name timba \
  --mount-path programs/timba
```

Complete remote verification and require a successful result. The release is incomplete until the executable hash, local generated IDL, source commit, downstream client artifacts, and remote verification record all agree.

## Initial deployments

`initialize_oracle` is only for a fresh program whose Oracle PDA does not exist. It requires signatures from:

- The current upgrade authority recorded in the program's upgradeable-loader ProgramData account.
- The intended Oracle operator, which becomes the runtime authority and funds Oracle account creation.

The canonical initial configuration is:

| Setting         |           Value |
| --------------- | --------------: |
| Fee percentage  |              1% |
| Fee recipient   | Treasury wallet |
| Oracle buffer   |   3,600 seconds |
| Maximum tickets |             100 |
| Maximum timeout |  86,400 seconds |
| Minimum timeout |     300 seconds |

Do not initialize a new Oracle during a routine executable upgrade.

## Release evidence

Retain:

- Public commit SHA
- Verifiable executable and hash
- IDL and hash
- Program state before and after deployment
- Deployment signature
- Downstream local-IDL comparison
- Local and remote verification results
- Account-compatibility evidence

References:

- [Anchor verifiable builds](https://www.anchor-lang.com/docs/references/verifiable-builds)
- [Solana verified builds](https://solana.com/docs/programs/verified-builds)
