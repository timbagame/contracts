use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Not authorized to perform this action.")]
    Unauthorized,
    #[msg("Invalid game status for this action")]
    InvalidGameStatus,
    #[msg("Game is already full")]
    GameFull,
    #[msg("Player has already joined")]
    AlreadyJoined,
    #[msg("Invalid token mint")]
    InvalidToken,
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
    #[msg("Not the winner")]
    NotWinner,
    #[msg("Signature required for private game")]
    SignatureRequired,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Game is not private")]
    GameNotPrivate,
    #[msg("Invalid operator")]
    InvalidOperator,
    #[msg("Timeout reached")]
    TimeoutReached,
    #[msg("Invalid participant count")]
    InvalidParticipantCount,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Game is completed")]
    GameCompleted,
    #[msg("Invalid vault")]
    InvalidVault,
    #[msg("Invalid participant")]
    InvalidParticipant,
    #[msg("Fee percentage must be between 0 and 100")]
    InvalidFeePercentage,
}
