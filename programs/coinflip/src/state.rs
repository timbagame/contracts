use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

#[account]
#[derive(Default)]
pub struct Oracle {
    pub authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: u16,
    pub max_players: u16,
    pub max_timeout: u32,
    pub min_timeout: u32,
}

#[account]
#[derive(Default)]
pub struct GameToken {
    pub ticker: String,
    pub token_mint: Pubkey,
    pub game_token_account: Pubkey,
    pub game_vault: Pubkey,
    pub bump: u8,
    pub min_amount: u64,
    pub fee_amount: u64,
    pub enabled: bool,
}

#[account]
#[derive(Default)]
pub struct PlayerBalance {
    pub player: Pubkey,
    pub token_mint: Pubkey,
    pub player_token_account: Pubkey,
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
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub max_players: u16,
    pub min_players: u16,
    pub players: Vec<Pubkey>,
    pub winner: Pubkey,
    pub status: GameStatus,
    pub token_mint: Pubkey,
    pub created_at: u64,
    pub timeout: u32,
    pub is_private: bool,
}

impl Game {
    pub fn ready_for_oracle(&self, current_time: i64) -> bool {
        let has_min_players = self.players.len() >= self.min_players as usize;
        let has_max_players = self.players.len() == self.max_players as usize;
        let timeout_met = current_time as u64 >= self.created_at + self.timeout as u64;

        (has_min_players && timeout_met) || has_max_players
    }

    pub fn buffer_passed(&self, oracle_buffer_time: u16, current_time: i64) -> bool {
        current_time as u64 >= self.created_at + self.timeout as u64 + oracle_buffer_time as u64
    }

    pub fn derive_pda(&self, secret_key: [u8; 64]) -> Pubkey {
        let random_hash = hash(secret_key.as_ref());
        let program_id = crate::ID;
        let (pda, _) = Pubkey::find_program_address(&[b"game", random_hash.as_ref()], &program_id);

        pda
    }

    pub fn calculate_winner(&self, secret_key: [u8; 64]) -> Pubkey {
        let n_players = self.players.len() as u64;
        if n_players == 1 {
            return self.players[0];
        }

        let random_number = u64::from_le_bytes(secret_key[0..8].try_into().unwrap());
        let max_valid = u64::MAX - (u64::MAX % n_players);
        let final_number = random_number % max_valid;
        let index = (final_number % n_players) as usize;

        self.players[index]
    }

    pub fn calculate_amounts(&self, players_len: u64, fee_percentage: u8) -> (u64, u64) {
        let total_amount = self.amount * players_len;
        let fee_amount = total_amount * fee_percentage as u64 / 100;
        let winner_amount = total_amount - fee_amount;

        (winner_amount, fee_amount)
    }
}
