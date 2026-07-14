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

Version 0.2.0 changes the `Game` account layout and does not migrate existing Game accounts. Before upgrading an existing deployment, independently prove that every old-layout Game account is inert: it must have no tickets, participant hashes, or funds.

An executable upgrade does not resize or rewrite program-owned accounts. The global Oracle and GameToken layouts remain compatible with 0.2.0; drained legacy Game accounts retain their original allocation and remain inert.

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

Anchor deployment may be run with `--no-idl` when IDL publication is handled as a separate verified gate:

```bash
anchor deploy \
  --verifiable \
  --no-idl \
  --program-name timba \
  --provider.cluster mainnet \
  --provider.wallet <UPGRADE_AUTHORITY_KEYPAIR>
```

Dump the deployed executable and require its hash to match the frozen verifiable artifact before continuing.

## Publish the IDL

Publish the canonical IDL only after the executable matches. For a program with no existing Anchor v1 IDL account, initialize it; otherwise upgrade the existing IDL account.

Fetch the published IDL and compare it byte-for-byte with `target/idl/timba.json`:

```bash
anchor idl fetch \
  --provider.cluster mainnet \
  --out /tmp/timba-mainnet-idl.json \
  32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5
```

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

Complete remote verification and require a successful result. The release is incomplete until the executable hash, published IDL, source commit, and remote verification record all agree.

## Initial deployments

`initialize_oracle` is only for a fresh program whose Oracle PDA does not exist. It requires signatures from:

- The current upgrade authority recorded in the program's upgradeable-loader ProgramData account.
- The intended Oracle operator, which becomes the runtime authority and funds Oracle account creation.

The canonical initial configuration is:

| Setting         |          Value |
| --------------- | -------------: |
| Fee percentage  |             1% |
| Oracle buffer   |  3,600 seconds |
| Maximum tickets |            100 |
| Maximum timeout | 86,400 seconds |
| Minimum timeout |    300 seconds |

Do not initialize a new Oracle during a routine executable upgrade.

## Release evidence

Retain:

- Public commit SHA
- Verifiable executable and hash
- IDL and hash
- Program state before and after deployment
- Deployment signature
- Published-IDL comparison
- Local and remote verification results
- Account-compatibility evidence

References:

- [Anchor verifiable builds](https://www.anchor-lang.com/docs/references/verifiable-builds)
- [Solana verified builds](https://solana.com/docs/programs/verified-builds)
