use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Game already full")]
    GameFull,
    #[msg("Player already joined")]
    AlreadyJoined,
    #[msg("Game ready for oracle")]
    GameReadyForOracle,
    #[msg("Invalid players count")]
    InvalidPlayersCount,
    #[msg("Game not active")]
    GameNotActive,
    #[msg("Game completed")]
    GameCompleted,
    #[msg("Invalid timeout")]
    InvalidTimeout,
    #[msg("Invalid token")]
    InvalidToken,
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
