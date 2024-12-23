use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid game status for this action")]
    InvalidGameStatus,
    #[msg("Game is already full")]
    GameFull,
    #[msg("Player has already joined")]
    AlreadyJoined,
    #[msg("Invalid oracle address")]
    InvalidOracle,
    #[msg("Oracle hash already set")]
    OracleHashAlreadySet,
    #[msg("Game not full yet")]
    GameNotFull,
    #[msg("Game ready for claim")]
    GameReadyForClaim,
    #[msg("Game not ready for claim")]
    GameNotReadyForClaim,
    #[msg("Game ready for oracle")]
    GameReadyForOracle,
    #[msg("Not the winner")]
    NotWinner,
    #[msg("Signature required for private game")]
    SignatureRequired,
    #[msg("Timeout reached")]
    TimeoutReached,
    #[msg("Timeout not reached yet")]
    TimeoutNotReached,
    #[msg("Invalid players count")]
    InvalidPlayersCount,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Game is completed")]
    GameCompleted,
    #[msg("Invalid player")]
    InvalidPlayer,
    #[msg("Invalid timeout duration")]
    InvalidTimeout,
    #[msg("Insufficient balance in vault")]
    InsufficientVaultBalance,
    #[msg("Cannot cancel game with players")]
    GameNotEmpty,
    #[msg("Unauthorized join attempt - must be owner or authorized operator")]
    UnauthorizedJoin,
    #[msg("Invalid telegram group id")]
    InvalidTelegramGroupId,
    #[msg("Only the operator can perform this action")]
    UnauthorizedOperator,
    #[msg("Token is not enabled for use in games")]
    TokenNotEnabled,
}
