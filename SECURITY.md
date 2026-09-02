# Timba Contracts Security Model

This document describes the v0.3.0 trust model, authority boundaries, fund flows, and recovery rules. It is not an audit report or a guarantee that the program has no defects.

Program ID: `32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5`

## Security objectives

The program is designed to:

- Keep game custody and settlement rules on-chain.
- Bind each game to a secret commitment approved by the current oracle operator.
- Verify the revealed secret and recompute the winner during settlement.
- Prevent the operator from redirecting winner payouts, player refunds, or giveaway refunds.
- Limit the operator's exclusive settlement period.
- Keep protocol fees bounded and visible on-chain.
- Let users inspect game state and emitted events.

The design is not fully trustless. It depends on the program upgrade authority, the oracle operator, the off-chain creation policy, the supported token program, and the Solana network.

## Authorities

| Action               | Required signer or authority                    | On-chain restriction                                                         |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Initialize Oracle    | Intended operator and program upgrade authority | Upgrade authority is read from the program's `ProgramData` account           |
| Update Oracle        | Current operator and new operator               | Both sign; configuration must remain within its hard limits                  |
| Initialize game      | Creator and current operator                    | Amount must be positive and game limits must match the Oracle configuration  |
| Join public game     | Player                                          | Player must be unique, game must be open, and the mint must match            |
| Join private game    | Player and current operator                     | The operator approves each private join                                      |
| Unjoin               | Participant or game creator                     | Uses the same timeout/recovery rule and refunds only to the participant      |
| Complete game        | Current operator                                | Reveal, winner, recipient accounts, amounts, and timing are checked on-chain |
| Creator close        | Game creator                                    | Empty games close immediately; populated giveaways follow the recovery rule  |
| Operator close       | Current operator                                | Game must be empty and past the recovery boundary                            |
| Close current Oracle | Current operator and program upgrade authority  | Closes the canonical v0.3 Oracle PDA                                         |

The upgrade authority is the highest-trust role. It can deploy new program code. Users must treat its key custody and governance as part of the security model.

The oracle operator can rotate the operator, change the live Oracle configuration within on-chain limits, authorize games, approve private joins, settle valid games, and clean up eligible empty games. An operator update does not require the upgrade authority, but the new operator must sign.

## Commit and reveal

### Commitment

The oracle service generates a 32-byte `secret_key` and calculates:

```text
random_hash = SHA256(secret_key)
```

The game PDA uses `random_hash` as a seed. The creator and current operator must both sign `initialize_game`. The creator remains the transaction fee payer. A second game cannot use the same commitment while the first game account exists because it would resolve to the same PDA.

The intended signing flow is:

1. The oracle creates and stores the secret.
2. The creator builds the initialization transaction with a recent blockhash.
3. The oracle validates the commitment and accounts, then partially signs the transaction.
4. The creator signs and submits the same transaction.

Neither signer must disclose its private key to the other party.

### Winner calculation

Each join and unjoin updates `last_slot`. During completion, the program:

1. Verifies that `SHA256(secret_key)` equals the commitment used in the game PDA.
2. Selects index zero directly when the game has one participant.
3. Otherwise, calculates `SHA256(secret_key || last_slot_le_u64)` and uses rejection sampling over eight-byte windows to select an index without modulo bias.
4. Checks that the submitted `winner_index` equals the calculated index.
5. Checks that the winner address is the participant stored at that index.

If no acceptable entropy window exists, completion fails instead of using a biased fallback.

### Randomness limitations

The on-chain program proves consistency with the commitment and deterministic selection formula. It does not prove that the operator generated the secret uniformly or only generated one candidate commitment.

The operator knows the secret, and joins affect `last_slot` and participant ordering. Joins can therefore influence the final calculation input. Participant removal is blocked while a game can still become ready or be completed. The operator can also withhold settlement. These facts make the operator and client workflow part of the fairness assumptions.

Applications should record commitment issuance, reject reused commitments, use a cryptographically secure random generator, and monitor withheld settlements.

## Game readiness and recovery

A game is ready for completion when either condition is true:

- `tickets_count == max_tickets`; or
- `tickets_count >= min_tickets` and `created_at + timeout` has been reached.

The recovery boundary is:

```text
created_at + timeout + current_oracle_buffer_time
```

The Oracle buffer extends the game's configured timeout for recovery purposes. It is not a timer that starts when the game fills or otherwise becomes ready. The value is read from the live Oracle account and is not stored in each game. An operator update therefore changes the recovery boundary for open games, but the program restricts the buffer to 1 through 3,600 seconds.

Before timeout, participants cannot unjoin and the creator cannot remove them. Joining is therefore a commitment for the configured game duration. At timeout, a game below `min_tickets` is not completable, so participant removal becomes available immediately.

If the game is ready at timeout, participant removal and creator close remain blocked until the recovery boundary. At that boundary, completion is no longer accepted and recovery becomes available. Players and the creator use the same timing rule for participant removal; coinflip refunds always go to the removed player's canonical token account.

If a game fills early, it can be completed immediately, but participants cannot use the recovery path until the configured timeout and Oracle buffer have both elapsed. This rule keeps one recovery deadline and avoids storing or updating a separate fill timestamp.

An empty game can be closed by its creator immediately. A giveaway with participants cannot be closed before timeout. If it is underfilled at timeout, the creator can close it and recover the prize; if it is ready, the creator must wait until the recovery boundary.

## Fund flows

### Coinflip

- Each participant transfers one `ticket_amount` to the shared mint vault.
- A participant can hold only one active entry in a game.
- A permitted unjoin returns exactly one `ticket_amount`.
- Completion transfers the pot minus the fee to the winner and transfers the fee to the current Oracle operator.
- Creator close requires zero participants.

### Giveaway

- The creator transfers the complete prize to the vault during initialization.
- Players join without transferring tokens.
- Unjoin removes a participant but transfers no tokens.
- Completion transfers the prize minus the fee to the winner and the fee to the current Oracle operator.
- The creator can close an eligible giveaway even when participants remain. The full unspent prize returns to the creator's canonical token account.

### Fees

- The Oracle fee percentage must be between 0% and 10%.
- The fee percentage is read from the live Oracle during settlement. An operator update therefore changes the fee applied to existing games.
- The current Oracle operator receives the fee and must have a canonical token account for the game mint.
- Fee arithmetic uses a wider intermediate value before conversion to `u64`.

All token transfers use `transfer_checked` through the legacy SPL Token program. A failed transfer fails the complete Solana instruction and rolls back its state changes.

## Token custody

Each supported mint has one vault authority PDA and one canonical associated token account. All games for that mint share the token account.

The program checks:

- The legacy SPL Token program owns the mint and token accounts.
- The vault token account is canonical for the mint-derived vault authority.
- Player, creator, winner, and Oracle-operator token accounts are canonical for their owners and mint.
- Each game uses the mint stored in its account.

The program does not store an on-chain token allowlist. The off-chain oracle service decides which mints are enabled and which minimum amounts it will approve. If the operator key is compromised, an attacker can approve a positive-amount game for any legacy SPL mint whose canonical vault exists.

The shared-vault design reduces account creation but increases the effect of an accounting defect: a vault balance can contain funds for several games. The per-game accounting and atomic token transfers are therefore critical controls.

## Account closure

- Successful completion closes the `Game` account and returns its rent to the creator.
- Creator close returns `Game` rent to the creator.
- `operator_close_game` requires no participants and waits until the recovery boundary. It returns any giveaway prize to the creator and returns only the `Game` rent to the operator.
- `close_oracle` returns current Oracle rent to the current operator.

Oracle closure does not enumerate, settle, or close games. Normal game instructions require the canonical Oracle account. Closing it while games remain can make those games impossible to operate. Settle or close every game before closing the Oracle.

## Failure and compromise scenarios

### Oracle downtime or censorship

The operator can delay or refuse settlement. Coinflip participants can recover their stake when unjoin becomes available. Giveaway participants contributed no tokens, and the creator can recover the prize when close becomes available.

### Oracle key compromise

An attacker controlling the operator key can:

- Rotate the operator to another signer that it controls.
- Change the live fee percentage and other Oracle settings within hard limits.
- Approve games outside the off-chain token policy.
- Approve private joins.
- Settle games for which it knows valid secrets.
- Close eligible empty games and collect their rent.

The attacker cannot use the existing code to select a winner that does not match the reveal and game state, redirect a participant refund, redirect a giveaway cleanup refund, or set the fee above the on-chain 10% limit. Because the fee is live, a compromised operator can change the fee applied to open games.

If the legitimate operator still has control, rotate immediately with `update_oracle`. Also pause off-chain approvals, inspect recent configuration and game events, and prepare an upgrade-authority response if rotation is not possible.

### Upgrade-authority compromise

The upgrade authority can replace the program with different code. Together with the operator, it can also close the Oracle. Protect the authority with hardware-backed signing, multisignature governance, separation of duties, and reviewed deployment procedures.

### Oracle closure with live games

Closing the Oracle can block completion, unjoin, and close instructions because they require the canonical Oracle PDA. Operational controls must prove that no game remains before Oracle closure.

### Unsupported tokens

Token-2022 mints and extensions are not supported. Clients must not present them as valid Timba game tokens.

### Network or client failure

RPC errors, expired blockhashes, dropped transactions, or stale client data can make an action appear unsuccessful. Confirm the finalized transaction and current on-chain account state before retrying.

## User checklist

Before joining:

1. Confirm the program ID and game address.
2. Check the game type, mint, ticket amount, participant limits, timeout, and current Oracle fee percentage.
3. Confirm that the expected oracle operator approved the game.
4. For private games, understand that the operator must approve each join.
5. Risk only funds that you can afford to lose.

While a game is open:

1. Monitor the participant list and `last_slot`.
2. Distinguish the game timeout from the later recovery boundary.
3. Confirm a transaction on-chain before sending a replacement.

After completion:

1. Confirm that the revealed secret hashes to the original commitment as raw 32-byte data.
2. Recompute the winner from the secret, little-endian `last_slot`, and final participant order.
3. Verify the winner and fee transfers.

For example, to hash a 32-byte secret represented by 64 hexadecimal characters:

```bash
printf '%s' '<SECRET_HEX>' | xxd -r -p | sha256sum
```

Do not hash the textual hexadecimal representation itself.

## Release integrity

A verified build proves that a deployed executable matches a source commit. It does not prove that the source is secure.

For each mainnet release:

- Build from a clean public commit.
- Use the repository's pinned toolchain.
- Compare the local verifiable executable hash with the deployed program.
- Publish and synchronize the matching IDL and TypeScript client.
- Complete independent source verification.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the release and v0.3.0 migration procedure.

## Reporting a security issue

Use the repository owner's private security-reporting channel. Include the affected instruction, program ID, transaction signatures, expected behavior, observed behavior, and a minimal reproduction. Do not publish private keys, seed phrases, unrevealed game secrets, or exploit details in a public issue.
