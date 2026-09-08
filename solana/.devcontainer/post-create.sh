#!/bin/bash

# Install Solana and Anchor
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
source ~/.profile
source ~/.bashrc
solana-keygen new --no-bip39-passphrase

# Install Bun and project dependencies
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  source ~/.bashrc
fi

bun install
