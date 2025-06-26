use anchor_lang::prelude::*;

// =============================================================================
// ERROR DEFINITIONS
// =============================================================================

/// Custom error codes for the coinflip program.
///
/// Error codes are organized into ranges by category:
/// - 1000-1099: Authority and Permission Errors
/// - 1100-1199: Game State Errors
/// - 1200-1299: Player Action Errors
/// - 1300-1399: Configuration Errors
/// - 1400-1499: Token Errors
#[error_code]
pub enum ErrorCode {
    // =========================================================================
    // AUTHORITY AND PERMISSION ERRORS (1000-1099)
    // =========================================================================
    /// The provided authority does not match the required authority
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority = 1000,

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

    // =========================================================================
    // PLAYER ACTION ERRORS (1200-1299)
    // =========================================================================
    /// Player has already joined this game
    #[msg("Player already joined")]
    AlreadyJoined = 1200,

    /// Player does not have sufficient balance for this operation
    #[msg("Insufficient balance")]
    InsufficientBalance = 1201,

    /// Cannot unjoin Snowball games at all
    #[msg("Cannot unjoin Snowball games")]
    SnowballUnjoinNotAllowed = 1202,

    /// Exclusion proof verification failed
    #[msg("Invalid exclusion proof")]
    InvalidExclusionProof = 1203,

    /// Subtree proof structure is malformed or invalid
    #[msg("Malformed subtree proof")]
    MalformedSubtreeProof = 1204,

    /// Cannot locate subtree containing the specified player
    #[msg("Subtree not found")]
    SubtreeNotFound = 1205,

    /// Merkle tree structure error - unable to maintain proper binary tree
    #[msg("Merkle tree structure error")]
    MerkleTreeStructureError = 1206,

    // =========================================================================
    // CONFIGURATION ERRORS (1300-1399)
    // =========================================================================
    /// Player count configuration is invalid
    #[msg("Invalid players count")]
    InvalidPlayersCount = 1300,

    /// Timeout configuration is invalid
    #[msg("Invalid timeout")]
    InvalidTimeout = 1301,

    /// Amount configuration is invalid
    #[msg("Invalid amount")]
    InvalidAmount = 1302,

    /// The provided secret key does not match the random hash
    #[msg("Invalid secret key")]
    InvalidSecretKey = 1303,

    // =========================================================================
    // TOKEN ERRORS (1400-1499)
    // =========================================================================
    /// Token is not enabled for game operations
    #[msg("Token not enabled")]
    TokenNotEnabled = 1400,
}
