# Timba Contracts — Mainnet Deployment Guide

Follow this checklist when deploying the Anchor program to Solana mainnet-beta.

## Prerequisites

- Anchor CLI `v0.32.1` (matches `Anchor.toml`)
- Solana CLI `v2.3.13` configured with a funded mainnet wallet
- Program keypair generated and recorded in `Anchor.toml`
- Oracle operator keypair JSON file (distinct from deployer if desired)
- Fresh mainnet deployer keypair created solely for production; store the secret key offline (hardware wallet or encrypted cold storage) and keep redundant, secure backups

## 1. Generate the Deployer Keypair

Create the deployer key on an air-gapped or otherwise trusted machine:

```bash
solana-keygen new --outfile /tmp/timba-mainnet-deployer.json --no-bip39-passphrase
```

Record the public key (you will copy this into `Anchor.toml`):

```bash
solana-keygen pubkey /tmp/timba-mainnet-deployer.json
```

Immediately move the JSON file into secure, offline storage (hardware wallet export, encrypted drive, or sealed USB) and delete any plaintext copy from the online workstation once the deployment is complete.

## 2. Configure Environment

```bash
cd contracts
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair /path/to/deployer.json
export ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json
```

> `ORACLE_OPERATOR_KEYPAIR_PATH` ensures the migration script assigns oracle authority to a dedicated key instead of the deployer.
> Bring the deployer key onto a locked-down machine only long enough to sign the deployment, then remove it from the online system once the program is live.

## 3. Build and Deploy

```bash
anchor build
anchor deploy --no-idl
```

If you rely on Anchor migrations (e.g., `migrations/deploy.ts`) run:

```bash
anchor migrate
```

## 4. Distribute the IDL

1. Copy `target/idl/timba.json` to:
   - `../bot/idl/idl.json`
   - `../oracle/idl/idl.json`
2. Commit the updated IDL if appropriate.

## 5. Post-Deployment Checklist

- `solana program show BpdzqWdNJfgeVCsFHppS4WgeRZSRxt5iSj6xH4QdeR7t`
- Confirm the oracle account was created with the intended operator:
  ```bash
  anchor account oracle $(anchor keys list timba --program-id)
  ```
- Ensure both oracle and bot wallets are funded for fees.
- Archive the deployer key backups in offline storage after confirming the deployment; ongoing operations should not require this key.

## 6. Optional: Token Initialisation

Run the bot utility scripts from the project root after services are configured:

```bash
cd ../bot
ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json bun run scripts/initialize-game-token.ts
```

This registers the mainnet TIMBA and WSOL tokens with the on-chain oracle configuration.

## 7. Decommission & Program Shutdown

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
   solana program close BpdzqWdNJfgeVCsFHppS4WgeRZSRxt5iSj6xH4QdeR7t --recipient <SAFE_RECIPIENT_PUBKEY>
   ```
   The recipient address receives the reclaimed rent from remaining program accounts. Run this from the workstation holding the deployer/upgrade authority key, then remove that key from the machine and return it to offline storage.
