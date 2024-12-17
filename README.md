# Coinflip Contracts

A Solana smart contract implementation of a coin flip game using the Anchor framework.

## Development Environment

This project includes a devcontainer configuration for VS Code/Cursor and GitHub Codespaces, which automatically sets up all required dependencies in a containerized environment.

### Using Devcontainer (Recommended)

1. Prerequisites:
   - VS Code/Cursor
   - Docker

2. Setup:
   - Clone the repository
   - Open in VS Code/Cursor
   - When prompted, click "Reopen in Container"
   - Wait for the container to build and initialize (this will automatically install Solana, Anchor, and other dependencies)

### Manual Setup

If you prefer not to use devcontainers, you'll need to install the following prerequisites manually:

- [Rust](https://rustup.rs/)
- [Solana CLI Tools](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/)
- [Node.js](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/)

#### Manual Installation Steps

1. Install Solana:
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

2. Install Anchor:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
```

3. Install dependencies:
```bash
yarn install
```

## Building

Build the program:
```bash
anchor build
```

## Testing

Run the test suite:
```bash
anchor test
```

## Deployment

Deploy to your desired Solana cluster:
```bash
anchor deploy
```
