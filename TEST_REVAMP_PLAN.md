# Test Suite Revamp Plan

## Current State Analysis

### Existing Files:

- **`coinflip.ts`** (2873 lines): Legacy tests for older version, many tests don't work with current contract
- **`merkle-coinflip.ts`** (964 lines): Has some working tests but focuses heavily on merkle tree functionality
- **`merkle-helpers.ts`** (345 lines): Helper functions that are mostly working

### Issues with Current Tests:

- Massive monolithic test files that are hard to maintain
- Mix of working and broken tests in same files
- Heavy focus on merkle tree functionality that may not be current priority
- Duplicated setup code across tests
- Poor organization makes it hard to find specific test cases

## New Test Structure

### 1. Core Test Suite (`core.test.ts`)

**Purpose**: Basic game lifecycle and fundamental operations

- Oracle initialization and management
- Token configuration and management
- Game initialization with various parameters
- Player balance operations (initialize, deposit, withdraw)
- Basic join/unjoin operations
- Game completion flow
- Error handling for common failures
- Fee collection and distribution

### 2. Security Test Suite (`security.test.ts`)

**Purpose**: Edge cases, exploit prevention, and security validation

- State consistency tests (join/unjoin edge cases)
- Replay attack prevention (join, complete, roll)
- Arithmetic overflow/underflow protection
- Secret key validation and manipulation prevention
- Cross-game attack prevention
- Player index consistency after operations
- Orphaned account prevention
- Balance insufficient scenarios

### 3. Game Types Test Suite (`game-types.test.ts`)

**Purpose**: Different game variants and their specific rules

- **Coinflip games**: Standard 1v1 and multi-player scenarios
- **Giveaway games**: Creator-funded games with free participation
- **Snowball games**: Progressive games with roll functionality
- **Dumbflip games**: Immediate completion games (if supported)
- Game-specific restrictions and validations

### 4. Advanced Features Test Suite (`advanced.test.ts`)

**Purpose**: Complex functionality and edge cases

- Merkle tree operations and proofs
- Complex join/unjoin scenarios with swap-with-last
- Private games with operator validation
- Game timeouts and completion edge cases
- Multi-game scenarios
- Performance and scalability tests

### 5. Test Helpers (`test-helpers.ts`)

**Purpose**: Shared utilities and setup functions

- Global test state management
- Player creation and funding utilities
- Token mint creation and management
- Game PDA generation helpers
- Winner calculation utilities
- Common assertion helpers
- Setup/teardown functions

## Implementation Plan

### Phase 1: Foundation (High Priority)

1. ✅ Analyze current test files and identify working vs broken tests
2. ✅ Design new test structure with proper organization
3. 🔄 Create helper utilities (test-helpers.ts) for shared functionality
4. 🔄 Create core test suite (core.test.ts) for basic game operations

### Phase 2: Security & Game Types (High Priority)

5. 🔄 Create security test suite (security.test.ts) for edge cases and exploits
6. 🔄 Create game types test suite (game-types.test.ts) for different variants

### Phase 3: Advanced & Cleanup (Medium Priority)

7. 🔄 Create advanced features test suite (advanced.test.ts)
8. 🔄 Delete old test files after verification
9. 🔄 Update package.json test scripts if needed

## Key Improvements

### 1. Modular Organization

- Each file focuses on specific functionality
- Easier to find and run relevant tests
- Better separation of concerns

### 2. Reduced Duplication

- Shared utilities in test-helpers.ts
- Common setup/teardown functions
- Reusable player and game creation

### 3. Enhanced Maintainability

- Smaller, focused test files
- Clear naming conventions
- Logical grouping of related tests

### 4. Comprehensive Coverage

- Systematic testing of all game features
- Both happy path and edge case scenarios
- Security-focused testing approach

### 5. Better Development Experience

- Faster test execution with focused suites
- Easier debugging with smaller test files
- Clear test organization for new developers

## Test Execution Strategy

### Individual Test Suites

```bash
# Run specific test suites
anchor test tests/core.test.ts
anchor test tests/security.test.ts
anchor test tests/game-types.test.ts
anchor test tests/advanced.test.ts
```

### Full Test Suite

```bash
# Run all tests
anchor test
```

### Test Categories

```bash
# Run by priority
anchor test tests/core.test.ts tests/security.test.ts  # Critical functionality
anchor test tests/game-types.test.ts                   # Game variants
anchor test tests/advanced.test.ts                     # Advanced features
```

## Migration Notes

### From `coinflip.ts`:

- Extract working oracle and token tests → `core.test.ts`
- Extract security tests → `security.test.ts`
- Extract game type specific tests → `game-types.test.ts`
- Extract shared utilities → `test-helpers.ts`

### From `merkle-coinflip.ts`:

- Extract basic game operations → `core.test.ts`
- Extract merkle-specific functionality → `advanced.test.ts`
- Preserve working helper functions → `test-helpers.ts`

### From `merkle-helpers.ts`:

- Integrate useful functions into `test-helpers.ts`
- Remove merkle-specific code if not needed
- Keep winner calculation and core utilities

## Success Criteria

### Functionality

- [ ] All critical game operations have test coverage
- [ ] Security vulnerabilities are comprehensively tested
- [ ] All game types work correctly
- [ ] Error conditions are properly handled

### Code Quality

- [ ] No duplicated test setup code
- [ ] Clear, maintainable test structure
- [ ] Fast test execution
- [ ] Easy to add new tests

### Coverage

- [ ] Basic game lifecycle: 100%
- [ ] Security edge cases: 95%+
- [ ] Game type variants: 100%
- [ ] Error conditions: 90%+

## Timeline

- **Week 1**: Complete test-helpers.ts and core.test.ts
- **Week 2**: Complete security.test.ts and game-types.test.ts
- **Week 3**: Complete advanced.test.ts and cleanup
- **Week 4**: Final validation and documentation updates
