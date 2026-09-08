# Timba security

## Shared trust model

Both implementations hold game funds on-chain, verify a SHA-256 commitment,
recompute the winner, and restrict payout recipients. They are upgradeable:
the upgrade authority must be trusted with contract behavior and escrowed funds.

The Oracle is a trusted operator. It knows secrets before settlement, approves
creation and private entries, and can withhold a reveal. Public slot/block inputs
do not make this scheme fair against a malicious Oracle or sequencer. Commitment
uniqueness and token policy are enforced off-chain; there is no external VRF or
permanent on-chain consumed-commitment registry.

Fees and recovery buffers are live settings within contract ceilings. Recovery
depends on the underlying chain and token continuing to permit transfers.
Local tests are not an independent security audit.

## Implementation-specific boundaries

- [Solana security model](solana/SECURITY.md): program authority, account closure,
  shared mint vaults, SPL Token restrictions, and migration assumptions.
- [EVM security model](evm/SECURITY.md): proxy authority, signed authorizations,
  ERC-20 restrictions, retained storage, and upgrade compatibility.

## Reporting

Do not publish unrevealed secrets, credentials or exploit details in an issue.
If GitHub private vulnerability reporting is enabled, use this repository's
Security tab. Otherwise arrange a private reporting channel with the maintainers
before sharing sensitive details.
