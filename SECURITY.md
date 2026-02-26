# Security Model & User Guide

This document explains the security architecture and trust model of the TimbaGame smart contracts to help users understand how the system protects their funds and ensures fair gameplay.

## Core Security Architecture

### 1. Commit-Reveal Randomness Scheme

**How it works:**

- When a game is created, the creator commits to a random hash (without revealing the secret)
- Players join the game knowing only the hash, not the secret value
- After the game fills or times out, the oracle reveals the secret key
- The winner is calculated using both the secret key AND the blockchain slot number when the last player joined

**Security guarantees:**

- ✅ **Game creators cannot predict winners** - The slot number changes as players join
- ✅ **Players cannot influence outcomes** - They commit before knowing the secret
- ✅ **Cryptographically verifiable** - Anyone can verify the secret matches the original hash
- ✅ **Unbiased selection** - Uses mathematical algorithms to eliminate modulo bias

**Example verification:**

```javascript
// Anyone can verify this on-chain
const calculatedHash = sha256(secretKey);
assert(calculatedHash === originalCommittedHash);
```

### 2. Oracle Trust Model

**What the Oracle does:**

- Generates cryptographically random secrets for games
- Completes games by revealing secrets after conditions are met
- Collects platform fees as configured

**Trust assumptions:**

- ⚠️ **Oracle must be honest** - The platform operator controls the oracle
- ⚠️ **Oracle must be available** - Games depend on oracle completion
- ✅ **Oracle cannot steal player funds** - All fund transfers are cryptographically protected
- ✅ **Oracle cannot manipulate winners** - Randomness includes unpredictable slot numbers

**What if the oracle fails?**

- A buffer-based unjoin becomes available after the oracle buffer period
- Players can recover their funds if the oracle doesn't complete games
- No funds are ever permanently locked

### 3. Buffer Timeout Unjoin

**When can you recover funds?**

- If a game is not completed by the oracle within the buffer time
 - Typical buffer time: 24 hours after game timeout (configurable on the oracle)
- Only available for games that haven't been completed

**How to recover:**

1. Wait for the game timeout + configured oracle buffer time to expire
2. Call the `unjoin_game` instruction to reclaim your stake
3. Funds are returned directly to your token account

**Important notes:**

- ❌ **Cannot unjoin after game completion** - Once a winner is paid, the game is final
- ❌ **Cannot unjoin before timeout + buffer** - Prevents strategic early exits
- ✅ **Direct refunds** - Tokens return immediately; no claim queue

### 4. On-Chain Security Features

**Checks-Effects-Interactions (CEI) Pattern:**

- All state changes happen before external token transfers
- Prevents reentrancy attacks and state manipulation
- Industry-standard protection against common exploits

**Account closure:**

- Completed games automatically close and return rent to creators
- Prevents blockchain bloat and reduces ongoing costs
- Makes post-completion attacks impossible (no account to attack)

**Participation Tracking:**

- Efficient tracking of player participation without storing full lists
- Collision mitigation via explicit participant hash list (first 8 bytes of SHA256("timba:part:v1" || game_key || pubkey))
- Per-game salting prevents cross-game precomputation against player keys
- Simplified single-mode design (no special alternate states)

## Game Types and Risk Profiles

### Coinflip Games (Competitive)

- **Risk**: Players compete for the combined pot
- **Fairness**: Winner selected randomly from all participants
- **Payout**: Winner receives (total pot - platform fees)

### Giveaway Games (Creator-Funded)

- **Risk**: Players risk nothing (free to join)
- **Fairness**: Winner selected randomly from all participants
- **Payout**: Winner receives creator's contributed amount (minus fees)

## Fee Structure

**Platform Fees:**

- Configurable percentage (typically 5-10%)
- Deducted from game pot before winner payout
- Used to maintain platform operations

**Transparency:**

- Fee percentages are stored on-chain and publicly visible
- Cannot be changed mid-game (set at game creation)
- All fee calculations are performed on-chain and verifiable

## Best Practices for Users

### Before Joining a Game:

1. **Verify game parameters** - Check timeout, fees, and game type
2. **Understand the risk** - Only play with amounts you can afford to lose
3. **Check oracle status** - Ensure the platform is operational

### During Gameplay:

1. **Monitor timeouts** - Be aware of when games will complete
2. **Treat unjoin as a fallback** - Only usable after timeout + buffer if oracle fails
3. **Verify fairness** - Anyone can verify the randomness was fair after completion

### After Game Completion:

1. **Verify the outcome** - Check that the secret key matches the original hash
2. **Confirm fair winner selection** - The winner index should be mathematically correct
3. **Report issues** - Contact support if you detect any anomalies

## Security Audits and Monitoring

**Code Quality:**

- Follows Solana/Anchor best practices
- Implements proven security patterns
- Comprehensive test suite covering edge cases

**Continuous Monitoring:**

- Track unusual transaction patterns
- Monitor oracle performance and availability
- Alert systems for failed completions or errors

**Transparency:**

- All code is open source and auditable
- On-chain state is publicly verifiable
- Event logs provide complete game history

## What Could Go Wrong?

### Oracle-Related Risks:

- **Oracle downtime** → Players can unjoin after buffer time
- **Oracle manipulation** → Cryptographic verification + slot-based entropy prevents this
- **Oracle key compromise** → Would require new deployment; existing funds in games still protected by program logic

### Smart Contract Risks:

- **Code bugs** → Comprehensive testing and audits minimize this risk
- **Upgrade risks** → Program upgrades require proper governance
- **Solana network issues** → Would affect all Solana applications equally

### User Risks:

- **Private key compromise** → Use secure wallets and good practices
- **Phishing attacks** → Always verify you're using the official interface
- **Loss of stake** → Only risk the amount of your stake, nothing more

## Getting Help

**If you encounter issues:**

1. Check the game state on-chain using a Solana explorer
2. Verify your transaction succeeded and wasn't just pending
3. Wait for the appropriate timeout periods before assuming something is wrong
4. Contact platform support with transaction signatures for investigation

**Red flags to watch for:**

- Games that never complete (should become unjoinable after buffer expiry)
- Unexpected fee deductions (fees are fixed at game creation)
- Winners that don't match cryptographic verification
- Any requests for additional payments or "gas fees"

## Technical Resources

**Verify randomness yourself:**

```bash
# Example verification command (pseudo-code)
solana account <game-address> | grep secret_key
echo "<secret-key>" | sha256sum
# Compare with original committed hash
```

**Monitor your games:**

- Use Solana explorers to track your transactions
- Subscribe to game events to get completion notifications
- Check oracle health endpoints before playing

Remember: The goal of this security model is to make the system as trustless as possible while maintaining usability. While some trust in the oracle is required, cryptographic verification ensures that trust is minimized and verifiable.
