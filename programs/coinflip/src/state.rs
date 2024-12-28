use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Oracle {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: i64,
    pub games_counter: u64,
    pub players_counter: u64,
}

#[account]
#[derive(Default)]
pub struct GameToken {
    pub ticker: String,
    pub token_mint: Pubkey,
    pub enabled: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    Coinflip,
    Giveaway,
}

impl Default for GameType {
    fn default() -> Self {
        GameType::Coinflip
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameStatus {
    Active,
    ReadyForClaim,
    Completed,
    Cancelled,
}

impl Default for GameStatus {
    fn default() -> Self {
        GameStatus::Active
    }
}

#[account]
#[derive(Default)]
pub struct Game {
    pub id: u64,
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub max_players: u16,
    pub min_players: u16,
    pub players: Vec<Pubkey>,
    pub winner: Pubkey,
    pub status: GameStatus,
    pub token_mint: Pubkey,
    pub created_at: i64,
    pub timeout: i64,
    pub is_private: bool,
    pub fee_amount: u64,
}

impl Game {
    pub fn is_ready_for_oracle(&self) -> bool {
        self.players.len() >= self.min_players as usize
            && (Clock::get().unwrap().unix_timestamp >= self.created_at + self.timeout
                || self.players.len() == self.max_players as usize)
    }
}

#[account]
#[derive(Default)]
pub struct Player {
    pub id: u64,
    pub owner: Pubkey,
    pub is_bot: bool,
    pub bot_id: u8,
    pub bot_seed: String,
    pub bot_auth: bool,
    pub games_won: u64,
    pub games_lost: u64,
}
