use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

#[account]
#[derive(Default)]
pub struct Oracle {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: i64,
    pub max_players: u16,
    pub max_timeout: i64,
    pub min_timeout: i64,
    pub games_counter: u32,
}

#[account]
#[derive(Default)]
pub struct GameToken {
    pub ticker: String,
    pub token_mint: Pubkey,
    pub token_account: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub min_amount: u64,
    pub fee_amount: u64,
    pub enabled: bool,
}

#[account]
#[derive(Default)]
pub struct PlayerToken {
    pub player: Pubkey,
    pub token_mint: Pubkey,
    pub token_account: Pubkey,
    pub amount: u64,
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
    pub id: u32,
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
}

impl Game {
    pub fn ready_for_oracle(&self, current_time: i64) -> bool {
        let has_min_players = self.players.len() >= self.min_players as usize;
        let has_max_players = self.players.len() == self.max_players as usize;
        let timeout_met = current_time >= self.created_at + self.timeout;

        (has_min_players && timeout_met) || has_max_players
    }

    pub fn buffer_passed(&self, oracle_buffer_time: i64, current_time: i64) -> bool {
        current_time >= self.created_at + self.timeout + oracle_buffer_time
    }

    pub fn calculate_winner(&self, hash_value: [u8; 32], current_time: i64) -> Pubkey {
        let mut combined = [0u8; 40];
        combined[..32].copy_from_slice(&hash_value);
        combined[32..].copy_from_slice(&current_time.to_le_bytes());
        let final_hash = hash(&combined).to_bytes();
        let random_number = usize::from_le_bytes(final_hash[0..8].try_into().unwrap());
        let random_index = random_number % self.players.len();

        self.players[random_index]
    }

    pub fn calculate_total_amount(&self) -> u64 {
        if self.game_type == GameType::Coinflip {
            self.amount * self.players.len() as u64
        } else {
            self.amount
        }
    }

    pub fn calculate_fee_amount(&self, fee_percentage: u8, total_amount: u64) -> u64 {
        total_amount * fee_percentage as u64 / 100
    }
}
