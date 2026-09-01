use anchor_lang::prelude::*;

// ERROR DEFINITIONS

/// Custom error codes for the timba program.
///
/// Error codes are organized into ranges by category:
/// - 1000-1099: Operator and Permission Errors
/// - 1100-1199: Game State Errors
/// - 1200-1299: Player Action Errors
/// - 1300-1399: Configuration Errors
/// - 1400-1499: Token Errors
#[error_code]
pub enum ErrorCode {
    // OPERATOR AND PERMISSION ERRORS (1000-1099)
    /// The provided operator does not match the required operator
    #[msg("Unauthorized access")]
    UnauthorizedOperator = 1000,

    /// Player is not authorized to perform this action
    #[msg("Unauthorized access")]
    UnauthorizedPlayer = 1001,

    /// The provided creator account does not match the game creator
    #[msg("Creator mismatch")]
    InvalidCreator = 1002,

    // GAME STATE ERRORS (1100-1199)
    /// Game has reached maximum player capacity
    #[msg("Game full")]
    GameFull = 1100,

    /// Game is in oracle waiting period and cannot be modified
    #[msg("Awaiting oracle")]
    GameWaitingForOracle = 1101,

    /// Game does not meet requirements for oracle completion
    #[msg("Oracle not ready")]
    GameNotReadyForOracle = 1102,

    /// Cannot close game while players are still active
    #[msg("Active players remain")]
    GameHasActivePlayers = 1103,

    /// Game has exceeded its timeout duration
    #[msg("Game expired")]
    GameExpired = 1104,

    /// Game has already been completed
    #[msg("Game already settled")]
    GameAlreadyCompleted = 1105,

    /// Oracle buffer time has not expired yet for late unjoin / close operations
    #[msg("Oracle buffer active")]
    OracleBufferNotExpired = 1106,

    /// Program cannot allocate space for additional participants
    #[msg("Participant store full")]
    ParticipantStorageExceeded = 1107,

    // PLAYER ACTION ERRORS (1200-1299)
    /// Player has already joined this game
    #[msg("Already joined")]
    AlreadyJoined = 1200,

    /// Player does not have sufficient balance for this operation
    #[msg("Insufficient balance")]
    InsufficientBalance = 1201,

    /// Winner index provided by oracle does not match on-chain recomputation using secret key
    #[msg("Winner index mismatch")]
    WinnerIndexMismatch = 1202,

    /// Provided winner index is outside current tickets count range
    #[msg("Winner index out of range")]
    WinnerIndexOutOfRange = 1203,

    /// Winner pubkey does not match the participant at the provided index
    #[msg("Winner mismatch")]
    WinnerPubkeyMismatch = 1204,

    /// Player not authorized for private game
    #[msg("Private access denied")]
    PrivateGameAccessDenied = 1205,

    /// Failed to generate unbiased random number for winner selection
    #[msg("Randomness failed")]
    RandomnessGenerationFailed = 1206,

    /// Player is not present in the current participant set
    #[msg("Participant not found")]
    ParticipantNotFound = 1207,

    /// Participant index is outside the current participant set
    #[msg("Participant index out of range")]
    ParticipantIndexOutOfRange = 1208,

    /// Arithmetic operation would overflow or underflow
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow = 1209,

    // CONFIGURATION ERRORS (1300-1399)
    /// Ticket count configuration is invalid
    #[msg("Invalid config value")]
    InvalidTicketsCount = 1300,

    /// Timeout configuration is invalid
    #[msg("Invalid config value")]
    InvalidTimeout = 1301,

    /// Amount configuration is invalid
    #[msg("Invalid config value")]
    InvalidAmount = 1302,

    /// The provided secret key does not match the random hash
    #[msg("Secret key mismatch")]
    InvalidSecretKey = 1303,

    /// Oracle buffer time is outside the supported range
    #[msg("Invalid oracle buffer time")]
    InvalidOracleBufferTime = 1304,

    /// The supplied account is not an exact v0.2 Oracle account
    #[msg("Invalid legacy oracle account")]
    InvalidLegacyOracle = 1305,

    // TOKEN ERRORS (1400-1499)
    /// Token mint account does not match expected value
    #[msg("Token mint mismatch")]
    InvalidTokenMint = 1401,
    /// Fee recipient does not match the configured wallet
    #[msg("Fee recipient mismatch")]
    InvalidFeeRecipient = 1404,
}
