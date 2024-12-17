set -ef

# Install Solana  
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
echo 'export PATH="/home/codespace/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
solana-keygen new --no-bip39-passphrase

# Install Anchor
npm install -g @coral-xyz/anchor-cli
