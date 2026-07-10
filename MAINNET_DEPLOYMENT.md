# Timba Contracts — Mainnet Deployment Guide

Follow this checklist for every initial deployment or upgrade of the Timba program on Solana mainnet-beta. Mainnet releases must use a reproducible build from a public commit, deploy that exact artifact, publish the matching IDL, and complete remote source verification.

## Prerequisites

- Anchor CLI 1.1.2
- Solana CLI 3.1.10
- `solana-verify`
- Docker, required for reproducible builds
- A clean commit pushed to the public `timbagame/contracts` repository
- Solana CLI configured with a funded mainnet upgrade-authority wallet
- The existing program keypair and upgrade authority for an upgrade, or a newly generated program keypair for an initial deployment
- Oracle operator keypair JSON file (distinct from deployer if desired)
- Fresh mainnet deployer keypair created solely for production; store the secret key offline (hardware wallet or encrypted cold storage) and keep redundant, secure backups

## 1. Prepare the Signing Authorities

For an upgrade, use the existing upgrade authority. Do not generate a new program keypair or change the program ID.

For an initial deployment only, create the program keypair separately from the deployer wallet and confirm that its public key matches `declare_id!` and every `[programs.*]` entry in `Anchor.toml`.

If a dedicated deployer or upgrade-authority key is required, create it on an air-gapped or otherwise trusted machine:

```bash
solana-keygen new --outfile /tmp/timba-mainnet-deployer.json --no-bip39-passphrase
```

Record its public key:

```bash
solana-keygen pubkey /tmp/timba-mainnet-deployer.json
```

The deployer wallet pays for and authorizes deployment; its address is not the program ID and must not replace the program address in `Anchor.toml`. Immediately move the JSON file into secure, offline storage and delete any plaintext copy from the online workstation once deployment is complete.

## 2. Configure Environment

```bash
cd contracts
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair /path/to/deployer.json
export ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json
```

> `ORACLE_OPERATOR_KEYPAIR_PATH` ensures the migration script assigns oracle authority to a dedicated key instead of the deployer.
> Bring the deployer key onto a locked-down machine only long enough to sign the deployment, then remove it from the online system once the program is live.

## 3. Test and Freeze the Release

```bash
anchor test
git diff --exit-code
git diff --cached --exit-code
git push origin HEAD
export COMMIT_SHA=$(git rev-parse HEAD)
```

Use the exact value of `COMMIT_SHA` for remote verification. Do not deploy uncommitted code or amend the commit after building.

## 4. Build Reproducibly

```bash
cd programs/timba
anchor build --verifiable --solana-version 3.1.10
cd ../..
solana-verify get-executable-hash target/verifiable/timba.so
```

This build runs in a pinned container and writes the deployable program to `target/verifiable/timba.so`. Do not run `anchor build` or `cargo-build-sbf` between this step and deployment; those commands can replace the artifact with a binary that has a different hash.

## 5. Deploy the Verifiable Artifact and IDL

```bash
anchor deploy \
  --verifiable \
  --program-name timba \
  --provider.cluster mainnet \
  --provider.wallet /path/to/deployer.json
```

Anchor 1.1.2 uploads `target/idl/timba.json` by default through the Program Metadata Program. Do not pass `--no-idl`.

If the existing deployment has a legacy pre-v1 Anchor IDL account, close that legacy account with Anchor 0.32.1 before the first Anchor v1 upgrade. This is a one-time migration; confirm the account and authority before closing it.

## 6. Verify the Deployed Program Remotely

Verify the deployed executable against the exact public commit:

```bash
solana-verify verify-from-repo \
  -u https://api.mainnet-beta.solana.com \
  --program-id 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  https://github.com/timbagame/contracts \
  --commit-hash "$COMMIT_SHA" \
  --library-name timba \
  --mount-path programs/timba
```

Accept the prompt to publish the verification record on-chain, then submit the remote verification job. The uploader is normally the upgrade-authority address:

```bash
solana-verify remote submit-job \
  --program-id 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 \
  --uploader <UPGRADE_AUTHORITY_ADDRESS>

solana-verify remote get-job --job-id <JOB_ID>
```

Wait for the remote job to succeed and confirm that explorers report the program as verified.

References:

- [Anchor verifiable builds](https://www.anchor-lang.com/docs/references/verifiable-builds)
- [Solana verified builds and remote verification](https://solana.com/docs/programs/verified-builds)
- [Anchor v1 IDL migration](https://www.anchor-lang.com/docs/updates/release-notes/1-0-0)

## 7. Confirm and Distribute the IDL

Confirm that Anchor can fetch the published mainnet IDL:

```bash
anchor idl fetch \
  --provider.cluster mainnet \
  --out /tmp/timba-mainnet-idl.json \
  32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5
```

1. Copy `target/idl/timba.json` to:
   - `../bot/idl/idl.json`
   - `../oracle/idl/idl.json`
2. Regenerate and copy `target/types/timba.ts` to clients that use the generated Anchor type.
3. Commit and release the updated client artifacts with the same program release.

## 8. Initialize Program State on the First Deployment

Run the migration only when deploying a new program whose oracle state has not been initialized. Do not run it for a routine program upgrade.

```bash
ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json \
  anchor migrate \
  --provider.cluster mainnet \
  --provider.wallet /path/to/deployer.json
```

## 9. Post-Deployment Checklist

- `solana program show 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`
- Confirm the executable hash matches the reproducible artifact.
- Confirm the remote verification job succeeded.
- Confirm the published IDL is fetchable and matches the release commit.
- Confirm the oracle account was created with the intended operator:
  ```bash
  anchor account oracle $(anchor keys list timba --program-id)
  ```
- Ensure both oracle and bot wallets are funded for fees.
- Archive the deployer key backups in offline storage after confirming the deployment; ongoing operations should not require this key.

## 10. Optional: Token Initialisation

Run the bot utility scripts from the project root after services are configured:

```bash
cd ../bot
ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json bun run scripts/initialize-game-token.ts
```

This registers the mainnet TIMBA and WSOL tokens with the on-chain oracle configuration.

## 11. Decommission & Program Shutdown

When you need to retire the program, follow this sequence to halt new activity, settle outstanding games, and recover funds before closing the program.

1. **Disable new games**
   From the `bot/` directory, turn off each supported token so players cannot create additional games:

   ```bash
   cd ../bot
   ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json bun run scripts/disable-game-tokens.ts
   ```

2. **Force completion/cancellation of existing games**
   Run a manual scan with the oracle service (repeat until completed/not ready both return zero):

   ```bash
   cd ../oracle
   bun run scripts/manual-shutdown.ts
   ```

   This drives the `scanAndCompleteActiveGames()` loop, refunding players or distributing winnings so vaults empty out. Allow time for timeout-based cancellations to mature if any games remain “not ready”.

3. **Withdraw protocol fees**
   Use the bot helper to drain accumulated fees into the oracle operator wallet:

   ```bash
   cd ../bot
   ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json bun run scripts/withdraw-token-fees.ts
   ```

   The script creates missing ATAs for the operator (if needed) and withdraws fees for each configured token mint.

4. **Verify no state remains**

   - `solana account <game_token_pda>` should report zero lamports for every configured mint.
   - `anchor account oracle <oracle_pda>` should show zero outstanding balances and the intended operator key.

5. **Close the program (upgradeable loader)**
   ```
   solana program close 32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5 --recipient <SAFE_RECIPIENT_PUBKEY>
   ```
   The recipient address receives the reclaimed rent from remaining program accounts. Run this from the workstation holding the deployer/upgrade authority key, then remove that key from the machine and return it to offline storage.
