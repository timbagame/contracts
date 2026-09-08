# EVM security

Read the [shared trust model](../SECURITY.md) first.

The UUPS upgrade authority is separate from the Oracle operator. It can replace
contract logic and must be trusted with all escrow. Both authorities use
consensual transfer flows. UUPS interface checks do not establish storage-layout
compatibility; review and test upgrades against funded games.

Creation and private entries require Oracle signatures. Creation authorizations
bind the chain, proxy, creator, token, terms, commitment, nonce and deadline.
Nonces prevent replay but do not prove secret freshness. The Oracle must retire
commitments across retries and deployments.

Custody is pooled per ERC-20 at the proxy with per-game balances and aggregate
liabilities. Transfers use exact balance-delta checks and reentrancy protection.
Rebasing, transfer-tax and malicious tokens are unsuitable; token freeze/upgrade
powers can block recovery. Native ETH is not accepted as a stake.

Terminal games retain their data. Historical records do not hold already-paid
prizes. See the [contract guide](README.md) for randomness encoding, gas
measurements, recovery, deployment and upgrade procedures.
