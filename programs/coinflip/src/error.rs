use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // Game State Errors
    // ----------------
    #[msg("Game already full")]
    GameFull,
    #[msg("Game not active")]
    GameNotActive,
    #[msg("Game ready for oracle")]
    GameReadyForOracle,
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle,

    // Player Errors
    // ------------
    #[msg("Player already joined")]
    AlreadyJoined,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer,
    #[msg("Insufficient balance")]
    InsufficientBalance,

    // Game Configuration Errors
    // ------------------------
    #[msg("Invalid players count")]
    InvalidPlayersCount,
    #[msg("Invalid timeout")]
    InvalidTimeout,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid secret key")]
    InvalidSecretKey,

    // Authority Errors
    // ---------------
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority,

    // Token Errors
    // -----------
    #[msg("Token not enabled")]
    TokenNotEnabled,
}
