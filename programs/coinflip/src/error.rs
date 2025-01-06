use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Game already full")]
    GameFull,
    #[msg("Player already joined")]
    AlreadyJoined,
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle,
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
    #[msg("Game not active")]
    GameNotActive,
    #[msg("Game completed")]
    GameCompleted,
    #[msg("Invalid timeout")]
    InvalidTimeout,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer,
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,
    #[msg("Token not enabled")]
    TokenNotEnabled,
    #[msg("Invalid amount")]
    InvalidAmount,
}
