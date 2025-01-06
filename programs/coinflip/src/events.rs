use anchor_lang::prelude::*;

#[event]
pub struct GameInitialized {
    pub game_id: u32,
}

#[event]
pub struct PlayerJoined {
    pub game_id: u32,
    pub player: Pubkey,
}

#[event]
pub struct WinClaimed {
    pub game_id: u32,
    pub winner: Pubkey,
}

#[event]
pub struct GameCancelled {
    pub game_id: u32,
}

#[event]
pub struct PlayerUnjoined {
    pub game_id: u32,
    pub player: Pubkey,
}

#[event]
pub struct OracleHashSet {
    pub game_id: u32,
}
