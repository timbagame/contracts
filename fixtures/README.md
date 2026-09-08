# Shared game behavior

lifecycle.csv is consumed by the Rust game-state tests and Foundry transaction tests.
It covers both game types, zero through four participants, before/at/after expiry
and buffer boundaries, and three fee-rounding cases (180 rows).
Creation time is 1000, timeout is 100, and the live buffer is 10 seconds.
Amount is the stake per coinflip participant or the entire giveaway prize.
Expected settle/recover values are booleans encoded as 0 or 1.

Solidity creates and joins real proxy games, then attempts settlement and refunds
using snapshots. Rust exercises the same production state predicates and fee
calculation, and LiteSVM also executes the corpus against the built program.
Both transaction runners reject duplicate entries and test creator-assisted refunds. Both suites additionally retain chain-specific authorization,
operator rotation, refund ordering, and cross-game accounting tests.
