use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Oracle {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: i64,
    pub max_players: u16,
    pub max_timeout: i64,
    pub min_timeout: i64,
    pub games_counter: u64,
    pub players_counter: u64,
}

#[account]
#[derive(Default)]
pub struct GameToken {
    pub ticker: String,
    pub token_mint: Pubkey,
    pub min_amount: u64,
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
    pub winner_amount: u64,
    pub fee_amount: u64,
}

impl Game {
    pub fn ready_for_oracle(&self) -> bool {
        let current_time = Clock::get().unwrap().unix_timestamp;
        let has_min_players = self.players.len() >= self.min_players as usize;
        let has_max_players = self.players.len() == self.max_players as usize;
        let timeout_met = current_time >= self.created_at + self.timeout;

        (has_min_players && timeout_met) || has_max_players
    }

    pub fn buffer_passed(&self, oracle_buffer_time: i64) -> bool {
        let current_time = Clock::get().unwrap().unix_timestamp;
        let buffer_passed = current_time >= self.created_at + self.timeout + oracle_buffer_time;

        buffer_passed
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
}
