# Timba EVM contracts

Solidity coinflips and giveaways for EVM networks. This is a separate, UUPS-upgradeable deployment; it does not change or migrate Solana accounts. No public network deployment has been performed.

## Build and test

Pinned tooling: Foundry **1.8.1**, Solidity **0.8.30**, OpenZeppelin **5.7.0**, forge-std **1.16.2**. Dependencies are git submodules pinned to commits in the parent repository and `foundry.lock`. Compilation targets **Cancun** because the selected OpenZeppelin release uses Cancun instructions. Confirm that a target L2 supports Cancun before deploying.

From the `evm/` directory:

```bash
git -C .. submodule update --init --recursive
forge fmt --check
forge build --sizes
forge test --gas-report
bash script/local-smoke.sh
```

The smoke test starts its own Anvil instance, uses public local-only keys, broadcasts deployment and the complete coinflip lifecycle, checks mined receipts, and stops the node. It uses port 18545 by default; override `TIMBA_SMOKE_PORT` if needed. Never fund these test keys on public networks.

`abi/Timba.json` is the exported client interface. Regenerate with:

```bash
forge inspect Timba abi --json > abi/Timba.json
```

## Rules and limits

| Setting         | Contract limit           | Deployment script default |
| --------------- | ------------------------ | ------------------------- |
| Players         | 1,000                    | 100                       |
| Minimum entries | Coinflip: 2; giveaway: 1 | Supplied per game         |
| Game duration   | 1 second–30 days         | 5 minutes–24 hours        |
| Oracle buffer   | 1 second–1 day           | 1 hour                    |
| Fee             | 0–10%, whole percentages | 1%                        |

The 1,000-player ceiling bounds storage and view responses. Joins and refunds use indexed membership and swap removal; settlement selects one participant and never loops over all entrants. Gas tests exercise settlement with 1,000 participants. Unlike Solana, there is no preallocated account with a 315-ticket limit. The client limit can remain 100.

- Coinflip entrants each deposit the same amount. Giveaway creation deposits the prize; entrants pay no stake.
- The creator may atomically join during creation. There is one entry per address per game.
- A full game can settle immediately. An underfilled game meeting its minimum can settle at expiry.
- No entries or re-entries after expiry. Before expiry, participants cannot withdraw.
- Under-minimum games permit refunds at expiry. Ready games permit recovery at `expiresAt + current buffer`, at which point settlement is forbidden.
- Only the participant or creator can request a participant refund. Payment always goes to that participant.
- Creators can close empty games immediately. Populated coinflips must refund every participant individually before closure. Giveaways can close at their recovery boundary and return the prize to their creator.
- The operator can close only empty games after the recovery boundary, with any prize returned to the creator. There is no operator custody-withdrawal function.
- Fee and buffer are live settings. Changing the duration/player limits applies only to new games. Token policy is enforced by the Oracle when signing creation requests; there is no on-chain token list.

## Authorization and replay protection

The owner is the Oracle operator. `transferOwnership` proposes a replacement and the new operator calls `acceptOwnership`. Renouncing ownership and transfer to the Timba contract itself are rejected. The separate upgrade authority controls UUPS upgrades; rotating the operator does not change that authority. No Oracle-deletion entry point exists.

Creation requires the creator to submit a transaction containing the current operator's EIP-712 signature. Both EOA and ERC-1271 operators are supported through OpenZeppelin SignatureChecker.

Domain: name `Timba`, version `1`, current chain ID, deployed contract address. The signed type is:

```text
CreateGame(address creator,address token,uint8 gameType,uint256 amount,uint32 minPlayers,uint32 maxPlayers,uint32 timeout,bool isPrivate,bytes32 commitment,uint256 nonce,uint256 deadline)
```

`gameType` is 0 for coinflip and 1 for giveaway. Use `creationDigest` to compare a client's typed-data encoding against the contract. Amounts are raw integer token units. Read `creationNonces(creator)` when authorizing creation. Successful creation advances that creator's nonce; failed transactions do not. Creators can invalidate outstanding authorizations by advancing their nonce. A refreshed authorization may use the same unconsumed nonce; only one can succeed.

Game IDs are `keccak256(abi.encode(chainId, contractAddress, creator, nonce))`. Private joins additionally require a current-operator EIP-712 signature over `JoinGame(bytes32 gameId,address player,uint256 deadline)`. Public joins do not need operator signatures. Creation already authorizes the optional creator entry.

Nonces prevent transaction replay; they do **not** prove commitment freshness. The Oracle must generate cryptographically secure secrets, reject commitment reuse across all deployments, and retain retirement across retries and recovery. There is no additional on-chain consumed-commitment registry.

## Commit–reveal specification

The commitment is `SHA256(secret)` over the raw 32-byte secret. Settlement verifies it and derives:

```text
entropy = keccak256(abi.encode(chainId, contractAddress, gameId, secret, lastEntryBlock))
```

Here `chainId` and `lastEntryBlock` are uint256, the contract is address, and gameId/secret are bytes32. This encoding deliberately differs from Solana's secret-plus-little-endian-slot formula. Use separate client implementations and the exported `winnerIndex` view for comparison.

Let `n` be the participant count and `threshold = 2^256 mod n`. Interpret entropy as an unsigned 256-bit integer. Accept values at least threshold, choosing `value % n`; otherwise rehash `keccak256(abi.encode(entropy, uint256(round)))`, starting at round zero, for at most 32 attempts. Failure reverts instead of introducing a biased fallback. The selected address comes directly from the participant array; callers cannot choose a payout recipient.

`lastEntryBlock` records Solidity's `block.number` at the last join/removal. On Arbitrum-family chains this must not be assumed to equal an RPC L2 block height. It is a public influenceable input, not secure independent randomness. The operator knows the secret, can influence entries or their timing, and can withhold settlement. This implementation preserves the trusted-operator model and makes no claim of fairness against a malicious operator or sequencer. Never put unrevealed secrets in logs or public simulation requests.

## Token custody

There is no on-chain token registration or allowlist. Each creation signature binds the token address, so the Oracle approves tokens off-chain by deciding what to sign. Only conventional ERC-20 tokens are supported. OpenZeppelin SafeERC20 and ReentrancyGuardTransient protect transfers and lifecycle mutations. Exact balance deltas reject fee-on-transfer behavior on incoming and outgoing transfers. Rebasing, malicious, or arbitrarily pausable tokens remain unsuitable; a token's own freeze/upgrade powers can prevent recovery despite these checks.

`liabilities(token)` tracks total outstanding game funds, and every payment reduces only its game's amount. Each game stores its terminal status and participant data; nonces and game identifiers are not recycled. Unsolicited token transfers are not credited to a game and have no sweep function. Native ETH is used for transaction gas, not stakes; use an approved wrapped token if appropriate.

## Deployment

Use an encrypted Foundry keystore or hardware wallet supported by Forge. Set `TIMBA_OPERATOR` to the intended operator and `TIMBA_UPGRADE_AUTHORITY` to the upgrade administrator (ideally a separate multisig):

```bash
TIMBA_OPERATOR=0x... TIMBA_UPGRADE_AUTHORITY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --account deployer --broadcast --verify
```

Provide the target explorer's required verification configuration. The script deploys an implementation and an ERC1967Proxy initialized atomically with the operator, upgrade authority, and defaults above. Configure clients with the **proxy address**, which is also the EIP-712 verifying contract. The implementation itself cannot be initialized.

## Upgrades and storage

UUPS upgrades replace the implementation while keeping the proxy address, token custody, and game state. The upgrade authority can change all contract behavior and must be trusted with escrowed funds. Transfer that authority with `proposeUpgradeAuthority` followed by the recipient's `acceptUpgradeAuthority`; operator ownership is independent.

Deploy the reviewed new implementation, then upgrade using the upgrade authority's keystore:

```bash
TIMBA_PROXY=0x... TIMBA_IMPLEMENTATION=0x... forge script script/Upgrade.s.sol:Upgrade \
  --rpc-url "$RPC_URL" --account upgrade-admin --broadcast
```

This script is for upgrades without a migration call. Upgrades needing initialization of new fields require reviewed migration calldata. UUPS checks that the target supports the proxy interface; **it does not validate storage compatibility**. Preserve existing storage slot ordering, field types, and the layouts of Game and OracleConfig; never reorder, remove, or repurpose them. Review the old/new compiler storage layouts (`forge inspect Timba storage-layout`) and test upgrades with active games before broadcast. Dependencies use OpenZeppelin namespaced storage; new Timba fields must also respect existing layout.

Completed/closed games retain their record and participant indexes. Paid-out funds are removed from liabilities; retaining records does not retain prizes. EVM storage is paid when written, with no recurring rent. Unlike Solana account closure, deleting entries does not return the original storage cost: clearing slots consumes gas and can provide only limited transaction gas refunds. Clearing every participant would require work proportional to game size. The current implementation therefore retains terminal history; optional future cleanup should be bounded/batched, preserve replay protection, and rely on events for historical queries.

Tests upgrade funded games and verify game fields, configuration, participant indexes, nonces, signature domains, settlement, and recovery. The local Anvil smoke also upgrades between joining and settlement.

These contracts have local automated coverage but have not undergone an independent audit or Robinhood testnet validation. Public-network funding, ABI integration in clients, RPC confirmation policy, and Oracle service support are separate rollout steps.

## Cross-chain behavior

The contract and Solana implementation consume the same lifecycle/fee test corpus
in `../fixtures/lifecycle.csv`. EVM refund events include `removedIndex` (zero-based)
and `movedParticipant` (zero address when removing the last participant), matching
Solana swap-removal semantics. Update event consumers with the exported ABI.

Token amounts retain their native uint256 range; the configured maximum coinflip
pot must fit before creation. Solana applies the equivalent check against u64.
Chain-specific signatures, commitment-derived versus nonce-derived identifiers,
winner algorithms, storage cleanup, and player ceilings remain intentional differences.
