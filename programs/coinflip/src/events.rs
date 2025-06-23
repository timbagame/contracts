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
    /// Authority that controls the oracle
    pub authority: Pubkey,
    /// Fee percentage taken from game winnings (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout
    pub oracle_buffer_time: u16,
    /// Maximum players allowed in any game
    pub max_players: u32,
    /// Maximum timeout duration for games
    pub max_timeout: u32,
    /// Minimum timeout duration for games
    pub min_timeout: u32,
}

/// Emitted when oracle configuration is updated
#[event]
pub struct OracleUpdated {
    /// Previous authority
    pub old_authority: Pubkey,
    /// New authority
    pub new_authority: Pubkey,
    /// Updated fee percentage
    pub fee_percentage: u8,
    /// Updated buffer time
    pub oracle_buffer_time: u16,
    /// Updated maximum players
    pub max_players: u32,
    /// Updated maximum timeout
    pub max_timeout: u32,
    /// Updated minimum timeout
    pub min_timeout: u32,
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

/// Emitted when accumulated fees are withdrawn by authority
#[event]
pub struct TokenFeeWithdrawn {
    /// Authority that withdrew the fees
    pub authority: Pubkey,
    /// Token mint of the withdrawn fees
    pub token_mint: Pubkey,
    /// Amount of fees withdrawn
    pub amount: u64,
}

// =============================================================================
// PLAYER EVENTS
// =============================================================================

/// Emitted when a player's balance account is initialized
#[event]
pub struct PlayerBalanceInitialized {
    /// Player who initialized the balance
    pub player: Pubkey,
    /// Token mint for this balance
    pub token_mint: Pubkey,
}

/// Emitted when a player withdraws from their balance
#[event]
pub struct PlayerBalanceWithdrawn {
    /// Player who withdrew
    pub player: Pubkey,
    /// Token mint of the withdrawal
    pub token_mint: Pubkey,
    /// Amount withdrawn
    pub amount: u64,
}

/// Emitted when a player joins a game
#[event]
pub struct PlayerJoined {
    /// Game that was joined
    pub game_key: Pubkey,
    /// Player who joined
    pub player: Pubkey,
    /// Total prize amount after join
    pub total_amount: u64,
    /// Number of players after join
    pub players_count: u32,
    /// Player's index in the game
    pub player_index: u32,
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
    /// Remaining players count
    pub players_count: u32,
    /// Player's index that was removed
    pub player_index: u32,
    /// Last slot for entropy
    pub last_slot: u64,
    /// Timestamp of the unjoin
    pub timestamp: u64,
}


/// Emitted when a player rolls in Snowball/Dumbflip games
#[event]
pub struct PlayerRolled {
    /// Game where the roll occurred
    pub game_key: Pubkey,
    /// Player who rolled
    pub player: Pubkey,
    /// Total amount after roll
    pub total_amount: u64,
    /// Player's index in the game
    pub player_index: u32,
    /// Last slot for entropy
    pub last_slot: u64,
    /// Timestamp of the roll
    pub timestamp: u64,
}

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
    /// Maximum players allowed
    pub max_players: u32,
    /// Minimum players required
    pub min_players: u32,
    /// Token mint used for the game
    pub token_mint: Pubkey,
    /// Whether game is private
    pub is_private: bool,
    /// Game creation timestamp
    pub created_at: u64,
    /// Game timeout duration
    pub timeout: u32,
}

/// Emitted when a game is completed and winner is determined
#[event]
pub struct GameCompleted {
    /// Game that was completed
    pub game_key: Pubkey,
    /// Winner of the game
    pub winner: Pubkey,
    /// Total number of players who participated
    pub players_count: u32,
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
