use crate::state::GameType;
use anchor_lang::prelude::*;

#[event]
pub struct GameInitialized {
    pub game_id: u64,
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub max_players: u16,
    pub min_players: u16,
    pub timeout: i64,
    pub is_private: bool,
}

#[event]
pub struct PlayerJoined {
    pub game_id: u64,
    pub player: Pubkey,
}

#[event]
pub struct WinClaimed {
    pub game_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct GameCancelled {
    pub game_id: u64,
}

#[event]
pub struct PlayerUnjoined {
    pub game_id: u64,
    pub player: Pubkey,
}
