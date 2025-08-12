use anchor_lang::prelude::*;

// =============================================================================
// ERROR DEFINITIONS
// =============================================================================

/// Custom error codes for the coinflip program.
///
/// Error codes are organized into ranges by category:
/// - 1000-1099: Operator and Permission Errors
/// - 1100-1199: Game State Errors
/// - 1200-1299: Player Action Errors
/// - 1300-1399: Configuration Errors
/// - 1400-1499: Token Errors
#[error_code]
pub enum ErrorCode {
    // =========================================================================
    // OPERATOR AND PERMISSION ERRORS (1000-1099)
    // =========================================================================
    /// The provided operator does not match the required operator
    #[msg("Unauthorized operator")]
    UnauthorizedOperator = 1000,

    /// Player is not authorized to perform this action
    #[msg("Unauthorized player")]
    UnauthorizedPlayer = 1001,

    /// The provided creator account does not match the game creator
    #[msg("Invalid creator")]
    InvalidCreator = 1002,

    // =========================================================================
    // GAME STATE ERRORS (1100-1199)
    // =========================================================================
    /// Game has reached maximum player capacity
    #[msg("Game already full")]
    GameFull = 1100,

    /// Game is in oracle waiting period and cannot be modified
    #[msg("Game waiting for oracle")]
    GameWaitingForOracle = 1101,

    /// Game does not meet requirements for oracle completion
    #[msg("Game not ready for oracle")]
    GameNotReadyForOracle = 1102,

    /// Cannot close game while players are still active
    #[msg("Cannot cancel game with active players")]
    GameHasActivePlayers = 1103,

    /// Game has not been completed yet
    #[msg("Game not completed")]
    GameNotCompleted = 1104,

    /// Invalid game type for this operation
    #[msg("Invalid game type")]
    InvalidGameType = 1105,

    /// Game has exceeded its timeout duration
    #[msg("Game expired")]
    GameExpired = 1106,

    /// Game has already been completed
    #[msg("Game already completed")]
    GameAlreadyCompleted = 1107,

    /// Oracle buffer time has not expired yet - emergency operations not allowed
    #[msg("Oracle buffer time not expired")]
    OracleBufferNotExpired = 1108,

    // =========================================================================
    // PLAYER ACTION ERRORS (1200-1299)
    // =========================================================================
    /// Player has already joined this game
    #[msg("Player already joined")]
    AlreadyJoined = 1200,

    /// Player has already unjoined this game/ticket
    #[msg("Player already unjoined")]
    AlreadyUnjoined = 1201,

    /// Player does not have sufficient balance for this operation
    #[msg("Insufficient balance")]
    InsufficientBalance = 1202,

    /// Winner index does not match calculated winner from secret key
    #[msg("Invalid winner index")]
    InvalidWinnerIndex = 1203,

    /// Winner pubkey does not match participation entry
    #[msg("Winner pubkey mismatch")]
    WinnerPubkeyMismatch = 1204,

    /// Player not authorized for private game
    #[msg("Private game access denied")]
    PrivateGameAccessDenied = 1205,

    /// Failed to generate unbiased random number for winner selection
    #[msg("Randomness generation failed")]
    RandomnessGenerationFailed = 1206,

    // =========================================================================
    // CONFIGURATION ERRORS (1300-1399)
    // =========================================================================
    /// Ticket count configuration is invalid
    #[msg("Invalid tickets count")]
    InvalidTicketsCount = 1300,

    /// Timeout configuration is invalid
    #[msg("Invalid timeout")]
    InvalidTimeout = 1301,

    /// Amount configuration is invalid
    #[msg("Invalid amount")]
    InvalidAmount = 1302,

    /// The provided secret key does not match the random hash
    #[msg("Invalid secret key")]
    InvalidSecretKey = 1303,

    /// Oracle configuration parameters are invalid
    #[msg("Invalid configuration")]
    InvalidConfiguration = 1304,

    // =========================================================================
    // TOKEN ERRORS (1400-1499)
    // =========================================================================
    /// Token is not enabled for game operations
    #[msg("Token not enabled")]
    TokenNotEnabled = 1400,
}
