# Test Failures Fix Plan

## Overview
After running `anchor test`, we have 15 failing tests out of 71 total tests. The failures fall into several categories that need systematic fixes.

## Error Categories Analysis

### 1. Merkle Tree Issues (5 tests)
**Errors**: `InvalidMerkleProof` (7207), `MerkleTreeStructureError` (7206)

**Affected Tests:**
- `should handle game completion with small player count`
- `should handle large player counts with merkle trees` 
- `should support multi-player coinflip games`
- `should handle maximum capacity stress test`

**Root Cause:** 
- Tests are providing empty merkle proofs `[]` for game completion
- When players are in committed subtrees (not recent buffer), valid merkle proofs are required
- The contract expects proper merkle tree validation for players in subtrees

**Fix Strategy:**
1. Update test-helpers.ts to include merkle proof generation functions
2. Modify failing tests to generate proper merkle proofs when needed
3. Use empty proofs only for recent players (last 2 players in buffer)

### 2. Game Logic Issues (4 tests)
**Errors**: `InvalidAmount` (7302), `InvalidPlayersCount` (7300), `GameNotReadyForOracle` (7102)

**Affected Tests:**
- `should handle join and unjoin with player swapping` - InvalidAmount in unjoin
- `should create and complete a giveaway game` - GameNotReadyForOracle 
- `should allow zero amount for giveaway games` - InvalidAmount
- `should create a snowball game with roll functionality` - InvalidPlayersCount
- `should prevent unjoin in snowball games` - InvalidPlayersCount

**Root Cause:**
- Unjoin functionality might not be fully implemented or requires special parameters
- Giveaway games have different completion rules than coinflip games
- Zero amounts might not be allowed even for giveaway games
- Snowball games might require different player count validation

### 3. Player State Issues (2 tests)
**Errors**: `AlreadyJoined` (7200)

**Affected Tests:**
- `should handle rapid join/unjoin cycles`

**Root Cause:**
- Player state not being properly cleaned up after unjoin
- Test logic assumes unjoin works but player might still be marked as joined

### 4. Private Game Access Issues (2 tests)
**Errors**: `PrivateGameAccessDenied` (7210)

**Affected Tests:**
- `should require oracle operator approval for private games`
- `should reject joining private games without operator approval`

**Root Cause:**
- Private game logic might be different than expected
- Oracle operator signature might be required in different way
- Tests might have wrong expectations about private game access

### 5. Transaction/Balance Issues (2 tests)
**Errors**: Token transfer insufficient funds, Generic simulation errors

**Affected Tests:**
- `should handle large amounts without overflow` - Insufficient funds
- `should handle timeout completion with minimum players` - Generic error
- `should handle oracle buffer time expiry` - Generic error

**Root Cause:**
- Large amount test uses amount larger than available token balance
- Timeout tests might have timing or state issues

## Fix Plan by Priority

### Priority 1: Critical Game Logic Fixes

#### 1.1 Fix Merkle Proof Generation (HIGH)
**Files to modify:** `tests/test-helpers.ts`

```typescript
// Add merkle proof generation functions
export function generateValidMerkleProof(
  players: TestPlayer[], 
  winnerIndex: number, 
  gameState: any
): number[][] {
  // Implement proper merkle proof generation based on game structure
  // Check if winner is in recent buffer or committed subtrees
  // Return appropriate proof or empty array
}
```

**Action Items:**
1. Add merkle tree utility functions to test-helpers.ts
2. Implement proper proof generation logic
3. Update failing tests to use generated proofs
4. Test with both subtree players and recent buffer players

#### 1.2 Fix Game Type Validation (HIGH)
**Files to modify:** `tests/game-types.test.ts`, check contract logic

**Giveaway Games Issues:**
- Check if giveaway games require minimum player count to be met
- Verify if zero amounts are actually allowed for giveaways
- Fix completion timing for giveaway games

**Snowball Games Issues:**
- Check snowball game initialization requirements
- Verify minimum/maximum player count rules for snowball
- Fix player count validation logic

#### 1.3 Fix Private Game Logic (HIGH)
**Files to modify:** `tests/game-types.test.ts`

**Action Items:**
1. Investigate how private games actually work in the contract
2. Check if oracle operator needs to be passed differently
3. Verify private game access control logic
4. Update test expectations to match actual contract behavior

### Priority 2: Player State and Flow Fixes

#### 2.1 Fix Unjoin Functionality (MEDIUM)
**Files to investigate:** 
- `programs/coinflip/src/instructions/unjoin_game.rs`
- `tests/advanced.test.ts`

**Action Items:**
1. Check if unjoin instruction exists and is properly implemented
2. Verify unjoin parameters and requirements
3. Check if unjoin works for all game types or has restrictions
4. Update tests to use correct unjoin parameters or handle unsupported cases

#### 2.2 Fix Player State Cleanup (MEDIUM)
**Files to modify:** `tests/advanced.test.ts`

**Action Items:**
1. Ensure proper cleanup between test cycles
2. Verify player participation state tracking
3. Fix rapid join/unjoin test logic

### Priority 3: Balance and Timeout Fixes

#### 3.1 Fix Balance Issues (LOW)
**Files to modify:** `tests/advanced.test.ts`

**Action Items:**
1. Reduce large amount test to realistic values
2. Ensure players have sufficient token balances for all test scenarios
3. Add balance checks before operations

#### 3.2 Fix Timeout and Async Issues (LOW)
**Files to modify:** `tests/advanced.test.ts`

**Action Items:**
1. Add proper error handling for timeout tests
2. Increase timeouts if needed
3. Add better error logging for debugging

## Implementation Steps

### Step 1: Research Current Contract Implementation
1. **Read unjoin_game.rs** - Understand unjoin requirements and parameters
2. **Read complete_game.rs** - Understand merkle proof validation logic
3. **Read join_game.rs** - Understand private game access control
4. **Read error.rs** - Understand all error codes and conditions

### Step 2: Fix Test Helper Functions
1. **Add merkle proof utilities** to test-helpers.ts
2. **Add game state inspection** functions
3. **Add proper error handling** utilities
4. **Add game type specific helpers**

### Step 3: Fix Tests by Category
1. **Fix merkle tree tests** - Add proper proof generation
2. **Fix game type tests** - Correct game initialization and completion
3. **Fix private game tests** - Use correct access patterns
4. **Fix unjoin tests** - Use correct parameters or skip if unsupported
5. **Fix balance tests** - Use realistic amounts and proper setup

### Step 4: Verify and Clean Up
1. **Run tests iteratively** after each fix
2. **Add logging** for debugging remaining issues
3. **Clean up test code** and remove unnecessary complexity
4. **Document any limitations** or unsupported features

## Risk Assessment

### High Risk Areas
- **Merkle proof generation** - Complex logic that must match contract exactly
- **Game type differences** - Different rules for different game types
- **State management** - Player and game state synchronization

### Medium Risk Areas
- **Private game access** - Security-related logic that might be strict
- **Unjoin functionality** - Might not be fully implemented

### Low Risk Areas
- **Balance issues** - Usually simple parameter adjustments
- **Timeout issues** - Usually test timing problems

## Success Criteria
- [ ] All 71 tests passing
- [ ] No deprecated warnings
- [ ] Tests run in reasonable time (< 10 minutes)
- [ ] Tests are maintainable and well-documented
- [ ] All game types properly tested
- [ ] All security scenarios covered

## Notes
- Some features (like unjoin for certain game types) might not be implemented
- Tests should reflect actual contract capabilities, not ideal scenarios
- Focus on making tests match contract reality rather than changing contract
- Document any limitations found during investigation