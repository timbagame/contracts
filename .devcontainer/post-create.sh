set -ef

# Install Solana
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
echo 'export PATH="/home/codespace/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
solana-keygen new --no-bip39-passphrase
