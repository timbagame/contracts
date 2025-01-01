use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Game is already full")]
    GameFull,
    #[msg("Player has already joined")]
    AlreadyJoined,
    #[msg("Game not full yet")]
    GameNotFull,
    #[msg("Game ready for claim")]
    GameReadyForClaim,
    #[msg("Game not ready for claim")]
    GameNotReadyForClaim,
    #[msg("Game ready for oracle")]
    GameReadyForOracle,
    #[msg("Timeout reached")]
    TimeoutReached,
    #[msg("Invalid players count")]
    InvalidPlayersCount,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Game is completed")]
    GameCompleted,
    #[msg("Invalid timeout duration")]
    InvalidTimeout,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer,
    #[msg("Only the oracle can perform this action")]
    UnauthorizedOracle,
    #[msg("Token is not enabled for use in games")]
    TokenNotEnabled,
    #[msg("Fee percentage must be 5% or less")]
    InvalidFeePercentage,
    #[msg("Invalid amount")]
    InvalidAmount,
}
