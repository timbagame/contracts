use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // Authority and Permission Errors (1000-1099)
    // ------------------------------------------
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority = 1000,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer = 1001,
    #[msg("Invalid creator")]
    InvalidCreator = 1002,

    // Game State Errors (1100-1199)
    // -----------------------------
    #[msg("Game already full")]
    GameFull = 1100,
    #[msg("Game waiting for oracle")]
    GameWaitingForOracle = 1101,
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle = 1102,
    #[msg("Cannot cancel game with active players")]
    GameHasActivePlayers = 1103,
    #[msg("Game not completed")]
    GameNotCompleted = 1104,
    #[msg("Invalid game type")]
    InvalidGameType = 1105,
    #[msg("Game expired")]
    GameExpired = 1106,
    #[msg("Game already completed")]
    GameAlreadyCompleted = 1107,

    // Player Action Errors (1200-1299)
    // --------------------------------
    #[msg("Player already joined")]
    AlreadyJoined = 1200,
    #[msg("Insufficient balance")]
    InsufficientBalance = 1201,
    #[msg("Cannot unjoin Snowball game with multiple players")]
    SnowballMultiPlayerUnjoin = 1202,
    #[msg("Invalid last player index")]
    InvalidLastPlayerIndex = 1203,

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
