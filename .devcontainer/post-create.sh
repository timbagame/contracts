#!/bin/bash

# Install Solana and Anchor
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
source ~/.profile
source ~/.bashrc
solana-keygen new --no-bip39-passphrase
yarn install
