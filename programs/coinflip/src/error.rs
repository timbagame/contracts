use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Game already full")]
    GameFull,
    #[msg("Player already joined")]
    AlreadyJoined,
    #[msg("Game ready for oracle")]
    GameReadyForOracle,
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle,
    #[msg("Invalid secret key")]
    InvalidSecretKey,
    #[msg("Invalid players count")]
    InvalidPlayersCount,
    #[msg("Game not active")]
    GameNotActive,
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
