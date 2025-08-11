# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a comprehensive Solana smart contract implementing multiple gambling game types using the Anchor framework. Part of the larger Timba gaming platform, it features sophisticated bloom filter participation tracking, commit-reveal randomness, and support for both traditional and real-time game variants. The project structure follows standard Anchor conventions with a Rust program in `programs/coinflip/` and TypeScript tests in `tests/`.

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

🚨 **NEVER run individual test files with ts-mocha, yarn run, or any other direct commands!** 🚨
- Commands like `yarn run ts-mocha tests/collision-detection.test.ts` are FORBIDDEN
- There is NO quick way to test individual files in Anchor projects
- The ONLY options are: `anchor test` (full run) OR modify `Anchor.toml`
- Attempting individual test runs will fail and violate project constraints

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
- **state.rs**: Account structures (Oracle, Game, GameToken, PlayerGames) with size constants and bloom filter logic
- **instructions/**: Modular instruction handlers organized by functionality:
  - Oracle management (initialize/update oracle)
  - Token management (initialize/update token configs)
  - Player management (balance initialization/withdrawal)
  - Game lifecycle (initialize/join/roll/unjoin/complete/close)
  - Fee management (withdraw token fees)
- **error.rs**: Custom error definitions
- **events.rs**: Event definitions for program logging
- **utils.rs**: Shared utility functions

### Supported Game Types
- **Coinflip/Dumbflip** - Competitive games where players compete for the pot (traditional vs real-time)
- **Giveaway/Dumbaway** - Creator-funded games with free participation (traditional vs real-time)  
- **Snowball/Dumbball** - Progressive games with accumulating pot and multiple rolls (traditional vs real-time)

### Key Game Flow
1. Oracle initialization sets global game parameters and buffer timings
2. Token configuration defines min amounts and fees per supported SPL token
3. Players initialize balance accounts for deposits and participation tracking
4. Game creation with configurable parameters (amount, max/min players, timeout, game type)
5. Players join games tracked via dual bloom filter system in player balance accounts
6. Game completion uses commit-reveal scheme with cryptographically secure winner selection
7. Automatic fee collection and prize distribution

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
The project includes devcontainer configuration for VS Code/Cursor and GitHub Codespaces with automatic dependency installation. Manual setup requires Rust, Solana CLI, Anchor, Node.js, and Yarn. Use `yarn run setup-local` to initialize local test environment with funded accounts and token configurations.

### Code Organization Principles
- All instruction handlers are in separate files under `instructions/`
- Error codes are categorized by ranges (1000s for authority, 1100s for game state, etc.)
- Events are organized by functional area with comprehensive field documentation
- State structs include size constants for precise account space allocation

## Program ID
- Devnet/Localnet: `GLAicVgkhvVtAbcf9aF4iLqAXZ9GSrsfexoDUN2fBPCG`

## Important Development Notes

### Advanced Bloom Filter System (V2)
The system implements a sophisticated dual-layer safety architecture with collision detection for player participation tracking:

**Layer 1: Dual A/B Bloom Filter System with Collision Detection**
- `filter_a` and `filter_b` with `active_filter_index` switching (0 or 1)
- Only the **active filter** receives new participation data
- Both filters are **always checked** during verification for maximum safety
- **Collision Detection**: Cross-validates PlayerGames bloom filters against Game bloom filters
- **Automatic Recovery**: Detected collisions trigger immediate filter switching and cleanup
- **Emergency Unjoin Mode**: Activated during filter cleaning periods for safer unjoin operations

**Layer 2: Timestamp Protection**
- Mathematical guarantee: if game created after both filters' last update, cannot be in either filter
- Prevents impossible false positives through temporal logic
- Games newer than filter updates can skip bloom filter checks entirely

**Collision Detection Logic:**
- **Different Game Collision**: Player not in Game filter but flagged in PlayerGames filter
- **Temporal Collision**: PlayerGames filter updated before game was created
- **Recovery Process**: Switch to clean inactive filter, schedule old filter cleanup
- **Safety Buffers**: Uses `oracle.filter_cleanup_buffer` for timing calculations

### Critical Implementation Rules
- **Account Space**: `PLAYER_BALANCE_SIZE = 704 bytes` (includes discriminator + padding)
- **No Normal Cleanup**: Removed time-based filter cleanup - only collision-triggered cleanup
- **Emergency Mode Timing**: Uses `oracle.filter_cleanup_buffer` for deactivation timing
- **Winner Calculation Sync**: Must stay synchronized across Rust contract, TypeScript tests, and Oracle service
- **No Individual Test Execution**: Always use full `anchor test` suite (8+ minute runtime)
- **Memory Alignment**: Account for Rust struct padding when calculating sizes

### Bloom Filter Structure Details
**PlayerGames Filters:**
- `game_index_filter: [u64; 8]` - 512-bit filter for game+index participation tracking
- `unjoin_index_filter: [u64; 8]` - 512-bit filter for game+index unjoin tracking
- Dual filter sets (A/B) with metadata (last_updated, longest_expiry)
- **No recent_games buffer** - pure probabilistic tracking

**Game Filter (Safety Redundancy):**
- `participants_filter: [u64; 8]` - 512-bit filter for basic player participation
- Used for collision detection cross-validation
- Single filter per game (no A/B system needed)

**Hash Functions:**
- Three independent hash functions for each filter type
- Different salt values prevent cross-contamination
- Positions mapped to 512-bit range (0-511)
