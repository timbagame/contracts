use crate::state::GameType;
use anchor_lang::prelude::*;

// Oracle Events
#[event]
pub struct OracleInitialized {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: u16,
    pub max_players: u32,
    pub max_timeout: u32,
    pub min_timeout: u32,
}

#[event]
pub struct OracleUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: u16,
    pub max_players: u32,
    pub max_timeout: u32,
    pub min_timeout: u32,
}

// Token Events
#[event]
pub struct TokenInitialized {
    pub token_mint: Pubkey,
    pub min_amount: u64,
    pub enabled: bool,
}

#[event]
pub struct TokenUpdated {
    pub token_mint: Pubkey,
    pub min_amount: u64,
    pub enabled: bool,
}

#[event]
pub struct TokenFeeWithdrawn {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

// Player Events
#[event]
pub struct PlayerBalanceInitialized {
    pub player: Pubkey,
    pub token_mint: Pubkey,
}

#[event]
pub struct PlayerBalanceWithdrawn {
    pub player: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PlayerJoined {
    pub game_key: Pubkey,
    pub player: Pubkey,
    pub total_amount: u64,
    pub players_count: u32,
    pub player_index: u32,
    pub last_slot: u64,
    pub timestamp: u64,
}

#[event]
pub struct PlayerUnjoined {
    pub game_key: Pubkey,
    pub player: Pubkey,
    pub total_amount: u64,
    pub players_count: u32,
    pub player_index: u32,
    pub last_slot: u64,
    pub timestamp: u64,
}

#[event]
pub struct PlayerParticipationCleaned {
    pub game_key: Pubkey,
    pub player: Pubkey,
    pub total_amount: u64,
    pub players_count: u32,
    pub player_index: u32,
    pub refund_amount: u64,
    pub is_completed_game: bool,
    pub timestamp: u64,
}

#[event]
pub struct PlayerRolled {
    pub game_key: Pubkey,
    pub player: Pubkey,
    pub total_amount: u64,
    pub player_index: u32,
    pub last_slot: u64,
    pub timestamp: u64,
}

// Game Events
#[event]
pub struct GameInitialized {
    pub game_key: Pubkey,
    pub creator: Pubkey,
    pub game_type: GameType,
    pub ticket_amount: u64,
    pub total_amount: u64,
    pub max_players: u32,
    pub min_players: u32,
    pub token_mint: Pubkey,
    pub is_private: bool,
    pub created_at: u64,
    pub timeout: u32,
}

#[event]
pub struct GameCompleted {
    pub game_key: Pubkey,
    pub winner: Pubkey,
    pub players_count: u32,
    pub winner_amount: u64,
    pub fee_amount: u64,
    pub timestamp: u64,
}

#[event]
pub struct GameClosed {
    pub game_key: Pubkey,
    pub timestamp: u64,
}
