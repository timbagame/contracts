# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Solana blockchain project implementing a coinflip smart contract game using the Anchor framework. The project structure follows standard Anchor conventions with a Rust program in `programs/coinflip/` and TypeScript tests in `tests/`.

## Common Commands

### Building and Testing
- `anchor build` - Build the Solana program
- `anchor test` - Run the test suite (uses ts-mocha with 1000000ms timeout)
- `yarn run setup-local` - Set up local development environment with airdrops and token creation

### Code Quality
- `yarn run lint` - Check code formatting with Prettier
- `yarn run lint:fix` - Fix code formatting issues

### Local Development
- Start local Solana validator: `solana-test-validator` (typically runs in background via test-ledger)
- The project is configured for localnet development by default (see Anchor.toml)

## Architecture

### Program Structure
The coinflip program (`programs/coinflip/src/`) is organized as follows:

- **lib.rs**: Main program entry point with all instruction handlers
- **state.rs**: Account structures (Oracle, Game, GameToken, PlayerBalance, PlayerParticipation) with size constants
- **instructions/**: Modular instruction handlers organized by functionality:
  - Oracle management (initialize/update oracle)
  - Token management (initialize/update token configs)  
  - Player management (balance initialization/withdrawal)
  - Game lifecycle (initialize/join/roll/unjoin/complete/close)
  - Fee management (withdraw token fees)
- **error.rs**: Custom error definitions
- **events.rs**: Event definitions for program logging
- **utils.rs**: Shared utility functions

### Key Game Flow
1. Oracle initialization sets global game parameters
2. Token configuration defines min amounts and fees per token
3. Players initialize balance accounts for deposits
4. Game creation with configurable parameters (amount, max/min players, timeout)
5. Players join games through participation accounts
6. Game completion uses commit-reveal scheme with hash-based winner selection
7. Fee collection and balance withdrawals

### Testing Architecture
Tests in `tests/coinflip.ts` include comprehensive scenarios for:
- Game lifecycle with multiple players
- Security measures (replay attack prevention, overflow handling)
- Player participation edge cases
- Winner calculation using the same algorithm as the contract

### Development Environment
The project uses devcontainer configuration for consistent development setup with pre-installed Solana tools, Anchor, and dependencies. Manual setup requires Rust, Solana CLI, Anchor, Node.js, and Yarn.

## Program ID
- Devnet/Localnet: `2J1SejHvJ3SaXTHttMDnUHXNB2zcs1y5Gvkd4XxDB8Fj`