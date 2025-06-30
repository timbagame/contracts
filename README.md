# Coinflip Contracts

A comprehensive Solana smart contract implementation of various gambling games using the Anchor framework. Part of the Timba gaming platform.

## Supported Game Types

- **Coinflip** - Traditional competitive games where players compete for the pot
- **Giveaway** - Creator-funded games with free participation for players
- **Snowball** - Progressive games with accumulating pot and multiple entry support
- **Dumbflip/Dumbaway/Dumbball** - Immediate completion variants for real-time play

## Architecture

The program implements a secure commit-reveal scheme for provably fair randomness:

1. **Game Creation** - Creator commits to a random hash
2. **Player Participation** - Players join with token stakes  
3. **Game Completion** - Oracle reveals secret key for unbiased winner selection
4. **Settlement** - Automatic distribution of winnings

### Key Security Features

- **CEI Pattern** - All instructions follow Checks-Effects-Interactions
- **Commit-Reveal Scheme** - Cryptographically secure randomness
- **Merkle Tree Verification** - Efficient player participation validation
- **Oracle Buffer Time** - Prevents games from being stuck in limbo

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

1. Install Solana and Anchor:
```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

2. Install dependencies:
```bash
yarn install
```

## Building

Build the program:
```bash
anchor build
```

## Testing

The project features a comprehensive, modular test suite organized by functionality:

- **`tests/core.test.ts`** - Basic game operations and lifecycle
- **`tests/security.test.ts`** - Security validation and edge cases  
- **`tests/game-types.test.ts`** - Different game variants (Coinflip, Giveaway, Snowball)
- **`tests/advanced.test.ts`** - Complex functionality and performance tests
- **`tests/test-helpers.ts`** - Shared utilities and test infrastructure

Run the complete test suite:
```bash
anchor test
```

**Note**: The test suite runs all files together - individual test file execution is not supported.

## Program Structure

```
programs/coinflip/src/
├── lib.rs              # Main program entry point with instruction handlers
├── state.rs            # Account structures and business logic
├── error.rs            # Custom error definitions
├── events.rs           # Event definitions for logging
└── instructions/       # Modular instruction handlers
    ├── initialize_oracle.rs
    ├── initialize_game.rs
    ├── join_game.rs
    ├── complete_game.rs
    └── ...
```

## Local Development

Set up local development environment:
```bash
yarn run setup-local
```

This creates a local test environment with:
- Funded test accounts
- Token mints and configurations  
- Oracle initialization

## Deployment

**Program ID**: `GLAicVgkhvVtAbcf9aF4iLqAXZ9GSrsfexoDUN2fBPCG` (devnet/localnet)

Deploy to your desired Solana cluster:
```bash
anchor deploy
```

## Code Quality

Check and fix code formatting:
```bash
yarn run lint        # Check formatting
yarn run lint:fix    # Fix formatting issues
```
