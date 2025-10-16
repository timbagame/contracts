# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a comprehensive Solana smart contract implementing multiple gambling game types using the Anchor framework. Part of the larger Timba gaming platform, it features sophisticated bloom filter participation tracking, commit-reveal randomness, and support for both traditional and real-time game variants. The project structure follows standard Anchor conventions with a Rust program in `programs/timba/` and TypeScript tests in `tests/`.

## Common Commands

### Building and Testing

- `anchor build` - Build the Solana program
- `anchor test` - Run the test suite (uses ts-mocha with 1000000ms timeout)
- `bun run setup-local` - Set up local development environment with airdrops and token creation

**CRITICAL TESTING RULES**:
🚨 **NEVER run `anchor test` with grep, pipes, tail, head, or any other commands!** 🚨

- Each test run takes 8+ minutes - ONLY run `anchor test` once
- Read the FULL output from that single run
- Do NOT use: `anchor test | grep`, `anchor test | tail`, etc.
- This wastes enormous amounts of time and must be avoided

🚨 **NEVER use `bun test` (or `bun run test`) - it's not a valid command for Anchor!** 🚨

- Anchor doesn't support running individual test files
- To run specific tests, edit `Anchor.toml` and modify the `[[test]]` section
- Only use `anchor test` to run the configured test suite
- Remember: `bun test` (or `bun run test`) will always fail with Anchor projects

🚨 **NEVER run individual test files with ts-mocha, bun run, or any other direct commands!** 🚨

- Commands like `bun run ts-mocha tests/collision-detection.test.ts` are FORBIDDEN
- There is NO quick way to test individual files in Anchor projects
- The ONLY options are: `anchor test` (full run) OR modify `Anchor.toml`
- Attempting individual test runs will fail and violate project constraints

### Code Quality

- `bun run lint` - Check code formatting with Prettier
- `bun run lint:fix` - Fix code formatting issues

### Local Development

- Start local Solana validator: `solana-test-validator` (typically runs in background via test-ledger)
- The project is configured for localnet development by default (see Anchor.toml)

### Testing Specific Scenarios

- Tests use the same winner calculation algorithm as the contract to verify correctness
- The test suite includes comprehensive edge cases for security validation
- Test timeout is set to 1000000ms due to Solana network interactions

## Architecture

### Program Structure

The timba program (`programs/timba/src/`) is organized as follows:

- **lib.rs**: Main program entry point with all instruction handlers
- **state.rs**: Account structures (Oracle, Game, GameToken) with size constants and bloom filter logic
- **instructions/**: Modular instruction handlers organized by functionality:
  - Oracle management (initialize/update oracle)
  - Token management (initialize/update token configs)
  - Game lifecycle & participation (initialize/join/unjoin/complete/close)
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
3. Game creation with configurable parameters (amount, max/min players, timeout, game type)
4. Players join games updating the game-level bloom filter + hash list
5. Game completion uses commit-reveal scheme with cryptographically secure winner selection
6. Automatic fee collection and prize distribution

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

- **PDA Seeds**: All PDAs use consistent seed patterns (`b"game"`, `b"oracle"`, `b"game_token"`, `b"game_vault"`)
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

The project includes devcontainer configuration for VS Code/Cursor and GitHub Codespaces with automatic dependency installation. Manual setup requires Rust, Solana CLI, Anchor, Node.js, and Bun. Use `bun run setup-local` to initialize local test environment with funded accounts and token configurations.

### Code Organization Principles

- All instruction handlers are in separate files under `instructions/`
- Error codes are categorized by ranges (1000s for authority, 1100s for game state, etc.)
- Events are organized by functional area with comprehensive field documentation
- State structs include size constants for precise account space allocation

## Program ID

- Devnet/Localnet: `BpdzqWdNJfgeVCsFHppS4WgeRZSRxt5iSj6xH4QdeR7t`

## Important Development Notes

### Bloom Filter Participation (Simplified)

Current approach:

- Each Game stores: a 512-bit `participants_filter` and an exact `participant_hashes` vector (first 8 bytes of SHA256("timba:part:v1" || game_key || pubkey)).
- Joining sets bloom bits + appends hash; completion relies on the exact hash list (eliminates false positives).
- No player-level bloom filters, no rotation, no cleanup scheduling buffers.
- Late unjoin depends only on `(timeout + oracle_buffer_time)` and does not rely on special modes.

### Critical Implementation Rules

- **Participant Tracking**: Trust core is hash list; bloom filter is advisory (fast membership hint). Keep them consistent.
- **Winner Calculation Sync**: Keep algorithms identical across Rust, tests, and oracle service.
- **Late Unjoin**: Enforce only after timeout + buffer; never reintroduce mode flags.
- **Test Execution**: Always full `anchor test` runs (8+ minutes); no per-file shortcuts.
- **Account Sizes**: Recalculate if adding fields (follow Anchor padding rules).

### Bloom Filter Structure Details

**Game Filter:**

- `participants_filter: [u64; 8]` - 512-bit bitset for coarse membership.
- `participant_hashes: Vec<u64>` - canonical order (ticket order) ensures deterministic winner verification.

**Hash Functions:**

- Three independent hash functions for each filter type
- Different salt values prevent cross-contamination
- Positions mapped to 512-bit range (0-511)
