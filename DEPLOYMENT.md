# Timba Contracts Deployment Guide

This guide defines the public build, upgrade, migration, and verification process for Timba Contracts v0.3.0.

Production service rollout, operator key custody, RPC configuration, monitoring, incident response, and cross-repository coordination belong in private operations documentation.

## Fixed release identity

| Item           | Value                                          |
| -------------- | ---------------------------------------------- |
| Program        | `timba`                                        |
| Program ID     | `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5` |
| Target cluster | Solana mainnet-beta                            |
| Release line   | v0.3.0                                         |

The production program keypair used by Anchor must derive the fixed program ID. Verify it before building or deploying:

```bash
solana-keygen pubkey <PRODUCTION_PROGRAM_KEYPAIR>
```

The command must return `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`.

## Supported toolchain

| Tool            | Version |
| --------------- | ------- |
| Rust            | 1.98.0  |
| Solana CLI      | 3.1.10  |
| Anchor CLI      | 1.1.2   |
| Bun             | 1.4.0   |
| Surfpool        | 1.5.0   |
| `solana-verify` | 0.5.1   |

Use `rust-toolchain.toml`, `Anchor.toml`, and `.github/workflows/ci.yml` as the repository sources of truth. A verifiable build also requires a container runtime supported by Anchor.

Before signing a release, record the tool versions:

```bash
rustc --version
solana --version
anchor --version
bun --version
surfpool --version
solana-verify --version
```

## Release requirements

Before any mainnet upgrade:

1. Select a public commit that contains the program source, lockfiles, generated IDL, and generated TypeScript client.
2. Confirm that the commit is on the intended release branch and that the working tree is clean.
3. Confirm the current program ID and upgrade authority on mainnet.
4. Confirm the production program keypair, upgrade-authority wallet, RPC endpoint, and expected balance impact.
5. Disable new game approvals in the off-chain service.
6. Review the account-compatibility requirements for the release.
7. Build, deploy, and verify the same executable artifact.

Never deploy from an uncommitted working tree.

## Validate the release commit

Install exactly the locked JavaScript dependencies:

```bash
bun install --frozen-lockfile
```

Run the release checks:

```bash
bun audit
bun run format:check
bun run lint
bun run typecheck
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
anchor build
git diff --exit-code -- target/idl/timba.json target/types/timba.ts
anchor test --skip-build
```

Require a clean release commit after the checks:

```bash
git status --short
git rev-parse HEAD
```

`git status --short` must produce no output. Record the commit SHA returned by `git rev-parse HEAD`.

## Build the release artifact

Build the verifiable executable with the pinned Solana toolchain:

```bash
anchor build \
  --verifiable \
  --program-name timba \
  --solana-version 3.1.10
```

The production artifact is:

```text
target/verifiable/timba.so
```

Do not deploy `target/deploy/timba.so` to mainnet.

Record the executable and generated-client hashes:

```bash
solana-verify get-executable-hash target/verifiable/timba.so
sha256sum target/idl/timba.json target/types/timba.ts
```

Run the verifiable build a second time in an independent, clean release environment. The executable hash must be identical.

## Record pre-upgrade state

Inspect the existing program:

```bash
solana program show \
  --url mainnet-beta \
  32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5
```

Record:

- Current program-data address.
- Current upgrade authority.
- Current executable hash.
- Current Oracle account data.
- Every open game account.
- Relevant token-vault balances.
- The release commit and local artifact hashes.

Stop if the observed program ID, authority, accounts, or balances do not match the approved release plan.

## Upgrade the program

Deploy the exact verifiable artifact with Anchor. `--no-idl` is required because this project keeps its generated IDL off-chain:

```bash
anchor deploy \
  --verifiable \
  --no-idl \
  --program-name timba \
  --program-keypair <PRODUCTION_PROGRAM_KEYPAIR> \
  --provider.cluster mainnet \
  --provider.wallet <UPGRADE_AUTHORITY_KEYPAIR>
```

Before signing, confirm again that the production program keypair derives the fixed program ID and that the provider wallet is the current on-chain upgrade authority. Anchor deploys `target/verifiable/timba.so` because `--verifiable` is set. It does not create or update an on-chain IDL account because `--no-idl` is set.

Record the deployment transaction signature.

## Verify the deployed executable

Dump the finalized on-chain program:

```bash
solana program dump \
  --url mainnet-beta \
  32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  /tmp/timba-mainnet.so
```

Calculate both hashes:

```bash
solana-verify get-executable-hash target/verifiable/timba.so
solana-verify get-executable-hash /tmp/timba-mainnet.so
```

The hashes must match before migration or service re-enablement.

Inspect the program again and confirm that its upgrade authority did not change unexpectedly:

```bash
solana program show \
  --url mainnet-beta \
  32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5
```

## Verify the public source

Create or update the on-chain verification record from the exact public commit:

```bash
solana-verify verify-from-repo \
  https://github.com/timbagame/contracts \
  --url https://api.mainnet-beta.solana.com \
  --program-id 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  --commit-hash <COMMIT_SHA> \
  --library-name timba \
  --mount-path programs/timba \
  --workspace-path . \
  --keypair <UPGRADE_AUTHORITY_SIGNER>
```

Review the requested on-chain write before approving it. For a multisignature upgrade authority, use the transaction-export flow supported by `solana-verify` instead of supplying a local keypair.

After the verification PDA exists, submit the remote verification job:

```bash
solana-verify remote submit-job \
  --url https://api.mainnet-beta.solana.com \
  --program-id 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  --uploader <UPGRADE_AUTHORITY_PUBKEY>
```

The release is not verified until the remote result succeeds and reports the same executable hash.

## Keep the IDL off-chain

This project does not create or update an on-chain Anchor IDL account. Do not run `anchor idl init` or `anchor idl upgrade`.

Publish these files with the release:

- `target/idl/timba.json`
- `target/types/timba.ts`

Downstream clients must use artifacts generated from the same release commit. Compare their hashes before service rollout.

## v0.2 to v0.3 migration

v0.3.0 is a breaking instruction and client migration. The `Oracle` and `Game` account layouts remain compatible with v0.2, but `GameToken` accounts and their management instructions are removed. Fees are transferred directly to the current Oracle operator during settlement, using the live Oracle fee percentage.

An executable upgrade does not close obsolete program-owned accounts. Complete the cleanup before installing code that no longer exposes the `GameToken` instructions.

### Before upgrading from v0.2

Complete these steps while the v0.2 executable is still installed:

1. Disable new game creation in every service.
2. Settle or close every v0.2 game.
3. Withdraw all accrued v0.2 fees.
4. Close every v0.2 `GameToken` account.
5. Close or otherwise account for each obsolete v0.2 token vault as required by the v0.2 program.
6. Prove that no v0.2 game or `GameToken` account remains.
7. Record the Oracle address, decoded configuration, lamport balance, and current upgrade authority.

Do not upgrade while a game or `GameToken` account still depends on the v0.2 executable.

### Preserve the Oracle

The v0.2 Oracle is the v0.3 Oracle. Do not close or reinitialize it during this upgrade. After deploying and hash-verifying v0.3.0, read the same canonical Oracle PDA and confirm that its operator, fee percentage, recovery buffer, ticket limit, and timeout limits are unchanged.

If the release plan changes any Oracle setting or rotates the operator, use `update_oracle` after deployment. Both the current and new operators must sign an operator rotation.

### Configure v0.3

The approved initial configuration is:

| Setting                            |          Value |
| ---------------------------------- | -------------: |
| Fee percentage                     |             1% |
| Recovery buffer after game timeout |  3,600 seconds |
| Maximum tickets                    |            100 |
| Maximum timeout                    | 86,400 seconds |
| Minimum timeout                    |    300 seconds |

Before enabling game approvals:

1. Read and decode the existing Oracle account with the v0.3 client.
2. Confirm its operator, fee percentage, buffer, ticket limit, and timeout limits.
3. Create and verify the canonical mint-vault ATA for each enabled legacy SPL mint.
4. Create and verify the current Oracle operator's ATA for each enabled mint.
5. Confirm that service clients use the v0.3.0 IDL and program ID.
6. Run a controlled end-to-end game with an approved test amount.
7. Enable new game approvals only after all checks pass.

## Future Oracle closure

`close_oracle` is for a current v0.3 Oracle. It requires the current operator and current program upgrade authority and returns rent to the operator.

Before a future incompatible upgrade:

1. Disable new game approvals.
2. Settle or close every game.
3. Call `close_oracle` while the installed executable can still deserialize the v0.3 account.
4. Upgrade and initialize the replacement state according to the new release plan.

For a same-version reset, `close_oracle` and `initialize_oracle` can be placed in one atomic transaction. Do not close the Oracle during a routine compatible executable upgrade.

## Release evidence

Retain:

- Release branch, tag, and public commit SHA.
- Tool versions and container image information.
- Local verifiable executable and hash.
- Deployed executable dump and hash.
- Generated IDL and TypeScript client hashes.
- Pre-upgrade and post-upgrade program state.
- Pre-upgrade and post-upgrade Oracle state.
- Game and token-account closure evidence.
- Deployment and migration transaction signatures.
- Local source-verification output.
- Verification PDA details and remote verification result.
- Downstream client artifact comparison.
- Approvals for service re-enablement.

## References

- [Anchor verifiable builds](https://www.anchor-lang.com/docs/references/verifiable-builds)
- [Solana verified builds](https://solana.com/docs/programs/verified-builds)
- [Solana verifiable-build CLI](https://github.com/solana-foundation/solana-verifiable-build)
