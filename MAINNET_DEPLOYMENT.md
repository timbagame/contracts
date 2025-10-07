# Timba Contracts — Mainnet Deployment Guide

Follow this checklist when deploying the Anchor program to Solana mainnet-beta.

## Prerequisites

- Anchor CLI `v0.31.1` (matches `Anchor.toml`)
- Solana CLI configured with a funded mainnet wallet
- Program keypair generated and recorded in `Anchor.toml`
- Oracle operator keypair JSON file (distinct from deployer if desired)

## 1. Configure Environment

```bash
cd contracts
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair /path/to/deployer.json
export ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json
```

> `ORACLE_OPERATOR_KEYPAIR_PATH` ensures the migration script assigns oracle authority to a dedicated key instead of the deployer.

## 2. Build and Deploy

```bash
anchor build
anchor deploy
```

If you rely on Anchor migrations (e.g., `migrations/deploy.ts`) run:

```bash
anchor migrate
```

## 3. Distribute the IDL

1. Copy `target/idl/timba.json` to:
   - `../bot/idl/idl.json`
   - `../oracle/idl/idl.json`
2. Commit the updated IDL if appropriate.

## 4. Post-Deployment Checklist

- `solana program show BpdzqWdNJfgeVCsFHppS4WgeRZSRxt5iSj6xH4QdeR7t`
- Confirm the oracle account was created with the intended operator:
  ```bash
  anchor account oracle $(anchor keys list timba --program-id)
  ```
- Ensure both oracle and bot wallets are funded for fees.

## 5. Optional: Token Initialisation

Run the bot utility scripts from the project root after services are configured:

```bash
cd ../bot
ORACLE_OPERATOR_KEYPAIR_PATH=/path/to/oracle-operator.json bun run scripts/initialize-game-token.ts
```

This registers the mainnet TIMBA and WSOL tokens with the on-chain oracle configuration.
