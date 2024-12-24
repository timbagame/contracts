use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Oracle {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub game_counter: u64,
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
    pub creator_telegram_id: Option<String>,
    pub telegram_group_id: Option<String>,
    pub game_type: GameType,
    pub amount: u64,
    pub max_players: u16,
    pub min_players: u16,
    pub players: Vec<Pubkey>,
    pub winner: u16,
    pub status: GameStatus,
    pub token_mint: Pubkey,
    pub created_at: i64,
    pub timeout: i64,
    pub is_private: bool,
}

impl Game {
    pub fn add_player(&mut self, player: Pubkey) {
        self.players.push(player);
    }

    pub fn is_ready_for_oracle(&self) -> bool {
        self.players.len() >= self.min_players as usize
            && (Clock::get().unwrap().unix_timestamp >= self.created_at + self.timeout
                || self.players.len() == self.max_players as usize)
    }

    pub fn get_winner(&self) -> Pubkey {
        self.players[self.winner as usize]
    }
}

#[account]
#[derive(Default)]
pub struct TelegramUser {
    pub telegram_id: String,
    pub owner: Option<Pubkey>,
    pub bot_auth: bool,
}
