# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Solana blockchain project implementing a coinflip smart contract game using the Anchor framework. The project structure follows standard Anchor conventions with a Rust program in `programs/coinflip/` and TypeScript tests in `tests/`.

## Common Commands

### Building and Testing
- `anchor build` - Build the Solana program
- `anchor test` - Run the test suite (uses ts-mocha with 1000000ms timeout)
- `yarn run setup-local` - Set up local development environment with airdrops and token creation

**CRITICAL TESTING RULES**: 
🚨 **NEVER run `anchor test` with grep, pipes, tail, head, or any other commands!** 🚨
- Each test run takes 8+ minutes - ONLY run `anchor test` once
- Read the FULL output from that single run
- Do NOT use: `anchor test | grep`, `anchor test | tail`, etc.
- This wastes enormous amounts of time and must be avoided

🚨 **NEVER use `yarn test` - it's not a valid command for Anchor!** 🚨
- Anchor doesn't support running individual test files
- To run specific tests, edit `Anchor.toml` and modify the `[[test]]` section
- Only use `anchor test` to run the configured test suite
- Remember: `yarn test` will always fail with Anchor projects

### Code Quality
- `yarn run lint` - Check code formatting with Prettier
- `yarn run lint:fix` - Fix code formatting issues

### Local Development
- Start local Solana validator: `solana-test-validator` (typically runs in background via test-ledger)
- The project is configured for localnet development by default (see Anchor.toml)

### Testing Specific Scenarios
- Tests use the same winner calculation algorithm as the contract to verify correctness
- The test suite includes comprehensive edge cases for security validation
- Test timeout is set to 1000000ms due to Solana network interactions

## Architecture

### Program Structure
The coinflip program (`programs/coinflip/src/`) is organized as follows:

- **lib.rs**: Main program entry point with all instruction handlers
- **state.rs**: Account structures (Oracle, Game, GameToken, PlayerBalance) with size constants and bloom filter logic
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
5. Players join games tracked via bloom filters in player balance accounts
6. Game completion uses commit-reveal scheme with hash-based winner selection
7. Fee collection and balance withdrawals

### Critical Game Security Patterns
The codebase implements several security patterns that must be preserved:

1. **CEI Pattern**: All instructions follow Checks-Effects-Interactions pattern:
   - VALIDATION: Input validation and constraint checking
   - STATE UPDATES: Modify account states
   - TOKEN TRANSFER: External SPL token interactions
   - EVENT EMISSION: Emit events for off-chain monitoring

2. **Commit-Reveal Scheme**: Games use hash-based randomness where:
   - Game creation commits to a random hash
   - Game completion reveals the secret key
   - Winner selection uses cryptographically secure randomness with bias elimination

3. **Bloom Filter Tracking**: Player participation tracked using 512-bit bloom filters with timestamp optimization for efficiency

### Account Architecture Patterns
- **PDA Seeds**: All PDAs use consistent seed patterns (`b"game"`, `b"oracle"`, `b"player_balance"`, etc.)
- **Account Validation**: Heavy use of constraints in `accounts.rs` for security validation
- **State Management**: Account states are designed for minimal rent and optimal serialization

### Testing Architecture
The test suite has been completely revamped with modular organization:

- **`tests/core.test.ts`** - Basic game operations and lifecycle testing
- **`tests/security.test.ts`** - Security validation, edge cases, and exploit prevention  
- **`tests/game-types.test.ts`** - Different game variants (Coinflip, Giveaway, Snowball)
- **`tests/advanced.test.ts`** - Complex functionality, bloom filters, and performance tests
- **`tests/test-helpers.ts`** - Shared utilities (TestUtils, TestEnvironment, winner calculation)

Key features:
- All tests use `anchor test` command - individual test file execution is not supported
- Comprehensive scenarios for game lifecycle with multiple players
- Security measures (replay attack prevention, overflow handling)
- Winner calculation using the same algorithm as the contract
- The JavaScript winner calculation in test-helpers.ts mirrors the Rust implementation exactly

### Development Environment
The project uses devcontainer configuration for consistent development setup with pre-installed Solana tools, Anchor, and dependencies. Manual setup requires Rust, Solana CLI, Anchor, Node.js, and Yarn.

### Code Organization Principles
- All instruction handlers are in separate files under `instructions/`
- Error codes are categorized by ranges (1000s for authority, 1100s for game state, etc.)
- Events are organized by functional area with comprehensive field documentation
- State structs include size constants for precise account space allocation

## Program ID
- Devnet/Localnet: `GLAicVgkhvVtAbcf9aF4iLqAXZ9GSrsfexoDUN2fBPCG`

## Important Development Notes
- **Bloom Filter Migration**: System has migrated from merkle trees to bloom filters for player participation tracking
- **Winner Validation**: Unlike merkle trees, bloom filters cannot validate winner pubkeys at completion time
- When modifying winner calculation logic, ensure the TypeScript test implementation stays synchronized
- Account space constants in `state.rs` must be updated if struct fields change
- The oracle buffer time mechanism prevents games from being stuck in limbo
- Token transfers use optimized balance + wallet token combinations via `utils.rs`
