use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // Authority and Permission Errors (1000-1099)
    // ------------------------------------------
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority = 1000,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer = 1001,

    // Game State Errors (1100-1199)
    // -----------------------------
    #[msg("Game not active")]
    GameNotActive = 1100,
    #[msg("Game already full")]
    GameFull = 1101,
    #[msg("Game ready for oracle")]
    GameReadyForOracle = 1102,
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle = 1103,

    // Player Action Errors (1200-1299)
    // --------------------------------
    #[msg("Player already joined")]
    AlreadyJoined = 1200,
    #[msg("Insufficient balance")]
    InsufficientBalance = 1201,

    // Configuration Errors (1300-1399)
    // --------------------------------
    #[msg("Invalid players count")]
    InvalidPlayersCount = 1300,
    #[msg("Invalid timeout")]
    InvalidTimeout = 1301,
    #[msg("Invalid amount")]
    InvalidAmount = 1302,
    #[msg("Invalid secret key")]
    InvalidSecretKey = 1303,

    // Token Errors (1400-1499)
    // ------------------------
    #[msg("Token not enabled")]
    TokenNotEnabled = 1400,
}
