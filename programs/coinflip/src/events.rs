use crate::state::GameType;
use anchor_lang::prelude::*;

// =============================================================================
// EVENT DEFINITIONS
// =============================================================================

// =============================================================================
// ORACLE EVENTS
// =============================================================================

/// Emitted when the global oracle account is initialized
#[event]
pub struct OracleInitialized {
    /// Operator that controls the oracle
    pub operator: Pubkey,
    /// Fee percentage taken from game winnings (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout
    pub oracle_buffer_time: u64,
    /// Maximum tickets allowed in any game
    pub max_tickets: u32,
    /// Maximum timeout duration for games
    pub max_timeout: u64,
    /// Minimum timeout duration for games
    pub min_timeout: u64,
}

/// Emitted when oracle configuration is updated
#[event]
pub struct OracleUpdated {
    /// Previous operator
    pub old_operator: Pubkey,
    /// New operator
    pub new_operator: Pubkey,
    /// Updated fee percentage
    pub fee_percentage: u8,
    /// Updated buffer time
    pub oracle_buffer_time: u64,
    /// Updated maximum tickets
    pub max_tickets: u32,
    /// Updated maximum timeout
    pub max_timeout: u64,
    /// Updated minimum timeout
    pub min_timeout: u64,
}

// =============================================================================
// TOKEN EVENTS
// =============================================================================

/// Emitted when a new token is initialized for games
#[event]
pub struct TokenInitialized {
    /// Token mint address
    pub token_mint: Pubkey,
    /// Minimum amount required for games
    pub min_amount: u64,
    /// Whether token is enabled
    pub enabled: bool,
}

/// Emitted when token configuration is updated
#[event]
pub struct TokenUpdated {
    /// Token mint address
    pub token_mint: Pubkey,
    /// Updated minimum amount
    pub min_amount: u64,
    /// Updated enabled status
    pub enabled: bool,
}

/// Emitted when accumulated fees are withdrawn by operator
#[event]
pub struct TokenFeeWithdrawn {
    /// Operator that withdrew the fees
    pub operator: Pubkey,
    /// Token mint of the withdrawn fees
    pub token_mint: Pubkey,
    /// Amount of fees withdrawn
    pub amount: u64,
}

// =============================================================================
// PLAYER EVENTS
// =============================================================================

/// Emitted when a player joins a game
#[event]
pub struct PlayerJoined {
    /// Game that was joined
    pub game_key: Pubkey,
    /// Player who joined
    pub player: Pubkey,
    /// Total prize amount after join
    pub total_amount: u64,
    /// Total number of tickets after join
    pub tickets_count: u32,
    /// Ticket index for this join
    pub ticket_index: u32,
    /// Last slot for entropy
    pub last_slot: u64,
    /// Timestamp of the join
    pub timestamp: u64,
}

/// Emitted when a player leaves a game before completion
#[event]
pub struct PlayerUnjoined {
    /// Game that was left
    pub game_key: Pubkey,
    /// Player who left
    pub player: Pubkey,
    /// Remaining total amount after unjoin
    pub total_amount: u64,
    /// Remaining total tickets count
    pub tickets_count: u32,
    /// Ticket index that was removed
    pub ticket_index: u32,
    /// Last slot for entropy
    pub last_slot: u64,
    /// Timestamp of the unjoin
    pub timestamp: u64,
}

// PlayerRolled event removed with roll instruction

// =============================================================================
// GAME EVENTS
// =============================================================================

/// Emitted when a new game is created
#[event]
pub struct GameInitialized {
    /// Game account address
    pub game_key: Pubkey,
    /// Game creator
    pub creator: Pubkey,
    /// Type of game created
    pub game_type: GameType,
    /// Amount per player (or total prize for giveaways)
    pub ticket_amount: u64,
    /// Initial total amount in the game
    pub total_amount: u64,
    /// Maximum tickets allowed
    pub max_tickets: u32,
    /// Minimum tickets required
    pub min_tickets: u32,
    /// Token mint used for the game
    pub token_mint: Pubkey,
    /// Whether game is private
    pub is_private: bool,
    /// Game creation timestamp
    pub created_at: u64,
    /// Game timeout duration
    pub timeout: u64,
}

/// Emitted when a game is completed and winner is determined
#[event]
pub struct GameCompleted {
    /// Game that was completed
    pub game_key: Pubkey,
    /// Winner of the game
    pub winner: Pubkey,
    /// Total number of tickets that participated
    pub tickets_count: u32,
    /// Amount awarded to the winner
    pub winner_amount: u64,
    /// Fee amount collected
    pub fee_amount: u64,
    /// Completion timestamp
    pub timestamp: u64,
}

/// Emitted when a game is closed by the creator
#[event]
pub struct GameClosed {
    /// Game that was closed
    pub game_key: Pubkey,
    /// Closure timestamp
    pub timestamp: u64,
}
