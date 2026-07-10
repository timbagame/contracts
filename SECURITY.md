# Security Model & User Guide

This document explains the security architecture and trust model of the TimbaGame smart contracts to help users understand how the system protects their funds and ensures fair gameplay.

## Core Security Architecture

### 1. Commit-Reveal Randomness Scheme

**How it works:**

- The oracle generates the secret and provides the commitment hash to the creator for `initialize_game`
- Players join the game knowing only the hash, not the secret value
- After the game fills or times out, the oracle reveals the secret key
- The winner is calculated using both the secret key AND the blockchain slot number when the last player joined
- An honest oracle only completes games whose secrets it issued (self-made commits are not settled)

**Security guarantees:**

- ✅ **Game creators cannot predict winners** - They receive only the hash; the oracle holds the secret
- ✅ **Players cannot influence outcomes** - They join before knowing the secret
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

- Once a game is ready for completion, unjoin is blocked until the oracle buffer ends
- After that buffer, players can recover coinflip stakes if the game was not completed
- No funds are ever permanently locked

### 3. Unjoin Rules

**When can you unjoin?**

- **Before the game is ready** (not full, and not min-tickets + timeout): unjoin is allowed
- **While waiting for the oracle** (ready for completion and still inside the buffer): unjoin is blocked
- **After buffer expiry** without completion: unjoin is allowed again
- Completed games close on settlement, so there is no post-completion unjoin

Ready for completion means: max tickets filled, **or** min tickets reached **and** game timeout elapsed. The buffer ends at `created_at + timeout + oracle_buffer_time` (oracle-configurable).

**How to recover after a stalled ready game:**

1. Wait until `created_at + timeout + oracle_buffer_time`
2. Call `unjoin_game` to reclaim a coinflip stake (`ticket_amount`; giveaways refund 0)
3. Funds return directly to your token account

**Important notes:**

- ❌ **Cannot unjoin after game completion** - Once a winner is paid, the game is final
- ❌ **Cannot unjoin while waiting for the oracle** - Ready games stay locked until buffer end
- ✅ **Early unjoin when not ready** - Underfilled games can leave without waiting for timeout + buffer
- ✅ **Creator may unjoin a participant** - Same timing rules as the player (`authority` = player or creator)
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
- **Close**: Creator may close and reclaim the prize when not waiting for the oracle, including underfilled games that still have participants

## Fee Structure

**Platform Fees:**

- Configurable percentage with a hard on-chain cap of 0–10%
- Deducted from game pot before winner payout
- Used to maintain platform operations

**Transparency:**

- Fee percentages are stored on-chain and publicly visible
- Settlement uses the current oracle fee (not snapshotted per game); updates apply to open games, still capped at 10%
- All fee calculations are performed on-chain and verifiable

## Best Practices for Users

### Before Joining a Game:

1. **Verify game parameters** - Check timeout, fees, and game type
2. **Understand the risk** - Only play with amounts you can afford to lose
3. **Check oracle status** - Ensure the platform is operational

### During Gameplay:

1. **Monitor timeouts** - Be aware of when games will complete
2. **Know when unjoin works** - Allowed before the game is ready; blocked while waiting for oracle; allowed again after buffer if settle fails
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
- Mainnet releases should be built reproducibly from a published commit and remotely verified against the deployed executable
- The matching Anchor IDL should be published on-chain so clients and explorers can inspect the program interface
- Event logs provide complete game history

The deployment procedure and verification commands are documented in [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md).

## What Could Go Wrong?

### Oracle-Related Risks:

- **Oracle downtime** → After a ready game’s buffer ends, players can unjoin (earlier unjoin still works if the game never became ready)
- **Oracle manipulation** → Cryptographic verification + slot-based entropy prevents this
- **Oracle key compromise** → Would require new deployment; existing funds in games still protected by program logic

### Smart Contract Risks:

- **Code bugs** → Comprehensive testing and audits minimize this risk
- **Upgrade risks** → Program upgrades require proper governance
- **Solana network issues** → Would affect all Solana applications equally
- **Token-2022 extensions** → Fee-on-transfer or transfer hooks can break shared-vault accounting; prefer simple enabled mints
- **Shared vault** → All games for a mint share one vault; solvency depends on correct per-game and fee accounting

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
- Unexpected fee deductions above 10% (hard cap; fee is the live oracle value at complete)
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
