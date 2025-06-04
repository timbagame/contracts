use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

// Constants for space calculation
pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 2 + 4 + 4;
pub const GAME_TOKEN_SIZE: usize = 8 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8;
pub const PLAYER_PARTICIPATION_SIZE: usize = 8 + 2;
pub const GAME_SIZE: usize = 8 + 32 + 1 + 8 + 2 + 2 + 2 + 32 + 8 + 4 + 1;

// Oracle account that manages global game settings and authority
#[account]
#[derive(Default)]
pub struct Oracle {
    // Authority that can update oracle settings and claim fees
    pub authority: Pubkey,
    // Percentage of game amount taken as fee (0-100)
    pub fee_percentage: u8,
    // Buffer time in seconds after game timeout before cancellation is allowed
    pub oracle_buffer_time: u16,
    // Maximum number of players allowed in a game
    pub max_players: u16,
    // Maximum timeout duration in seconds for a game
    pub max_timeout: u32,
    // Minimum timeout duration in seconds for a game
    pub min_timeout: u32,
}

impl Oracle {
    // Helper method to update oracle configuration
    pub fn update_config(
        &mut self,
        fee_percentage: u8,
        oracle_buffer_time: u16,
        max_players: u16,
        max_timeout: u32,
        min_timeout: u32,
        new_authority: Pubkey,
    ) {
        self.fee_percentage = fee_percentage;
        self.oracle_buffer_time = oracle_buffer_time;
        self.max_players = max_players;
        self.max_timeout = max_timeout;
        self.min_timeout = min_timeout;
        self.authority = new_authority;
    }

    // Validation helpers for constraints
    pub fn is_valid_fee_percentage(&self, fee_percentage: u8) -> bool {
        fee_percentage <= 100
    }

    pub fn is_valid_timeout(&self, max_timeout: u32, min_timeout: u32) -> bool {
        max_timeout >= min_timeout
    }

    pub fn is_valid_players_count(&self, max_players: u16) -> bool {
        max_players > 0
    }

    pub fn is_authorized_authority(&self, authority: &Pubkey) -> bool {
        self.authority == *authority
    }

    pub fn is_valid_timeout_range(&self, timeout: u32) -> bool {
        timeout >= self.min_timeout && timeout <= self.max_timeout
    }
}

// Game token configuration for supported tokens
#[account]
#[derive(Default)]
pub struct GameToken {
    // Minimum amount required to participate in games
    pub min_amount: u64,
    // Accumulated fee amount for this token
    pub fee_amount: u64,
    // Whether this token is enabled for games
    pub enabled: bool,
}

impl GameToken {
    // Helper method to update token configuration
    pub fn update_config(&mut self, min_amount: u64, enabled: bool) {
        self.min_amount = min_amount;
        self.enabled = enabled;
    }

    // Helper method to initialize token with mint
    pub fn initialize(&mut self, min_amount: u64, enabled: bool) {
        self.min_amount = min_amount;
        self.fee_amount = 0;
        self.enabled = enabled;
    }

    // Validation helpers for constraints
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn meets_min_amount(&self, amount: u64) -> bool {
        amount >= self.min_amount
    }
}

// Player's balance for a specific token
#[account]
#[derive(Default)]
pub struct PlayerBalance {
    // Current balance amount
    pub amount: u64,
}

impl PlayerBalance {
    // Helper method to refund amount to player balance
    pub fn refund(&mut self, amount: u64) {
        self.amount += amount;
    }

    // Validation helpers for constraints
    pub fn has_sufficient_balance(&self) -> bool {
        self.amount > 0
    }

    pub fn has_combined_balance(&self, token_account_amount: u64, required_amount: u64) -> bool {
        self.amount + token_account_amount >= required_amount
    }
}

// Player's participation in a specific game
#[account]
#[derive(Default)]
pub struct PlayerParticipation {
    // Player's position/index in the game (for winner calculation)
    pub player_index: u16,
}

// Type of game being played
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    // Two or more players compete for the pot
    Coinflip,
    // One or more players compete for a giveaway
    Giveaway,
}

impl Default for GameType {
    fn default() -> Self {
        GameType::Coinflip
    }
}

// Game instance that manages player participation and winner determination
#[account]
#[derive(Default)]
pub struct Game {
    // Creator of the game
    pub creator: Pubkey,
    // Type of game being played
    pub game_type: GameType,
    // Amount each player must contribute
    pub amount: u64,
    // Maximum number of players allowed
    pub max_players: u16,
    // Minimum number of players required
    pub min_players: u16,
    // Current number of players who have joined
    pub player_count: u16,
    // Token mint used for this game
    pub token_mint: Pubkey,
    // Timestamp when game was created
    pub created_at: u64,
    // Timeout duration in seconds
    pub timeout: u32,
    // Whether this is a private game requiring oracle approval
    pub is_private: bool,
}

impl Game {
    // Checks if the game meets minimum requirements and timeout conditions
    pub fn ready_for_oracle(&self, current_time: i64) -> bool {
        let has_min_players = self.player_count >= self.min_players;
        let has_max_players = self.player_count == self.max_players;
        let timeout_met = current_time as u64 >= self.created_at + self.timeout as u64;

        (has_min_players && timeout_met) || has_max_players
    }

    // Checks if the oracle buffer time has passed for cancellation
    pub fn buffer_passed(&self, oracle_buffer_time: u16, current_time: i64) -> bool {
        current_time as u64 >= self.created_at + self.timeout as u64 + oracle_buffer_time as u64
    }

    // Derives the PDA for this game using the secret key
    pub fn derive_pda(&self, secret_key: [u8; 32]) -> Pubkey {
        let random_hash = hash(secret_key.as_ref());
        let (pda, _) = Pubkey::find_program_address(&[b"game", random_hash.as_ref()], &crate::ID);
        pda
    }

    // Calculates the winner index using cryptographic randomness
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> u16 {
        let n_players = self.player_count;
        if n_players <= 1 {
            return 0;
        }

        // Use multiple u16 chunks and XOR them for better entropy distribution
        let chunk1 = u16::from_le_bytes(secret_key[0..2].try_into().unwrap());
        let chunk2 = u16::from_le_bytes(secret_key[2..4].try_into().unwrap());
        let chunk3 = u16::from_le_bytes(secret_key[4..6].try_into().unwrap());
        let chunk4 = u16::from_le_bytes(secret_key[6..8].try_into().unwrap());

        // XOR all chunks to mix entropy
        let random_number = chunk1 ^ chunk2 ^ chunk3 ^ chunk4;

        // Ensure fair distribution by avoiding modulo bias
        let max_valid = u16::MAX - (u16::MAX % n_players);
        let final_number = random_number % max_valid;
        let index = final_number % n_players;

        index
    }

    // Calculates prize distribution with fee deduction
    pub fn calculate_amounts(&self, fee_percentage: u8) -> (u64, u64) {
        let total_amount = match self.game_type {
            GameType::Coinflip => self.amount * self.player_count as u64,
            GameType::Giveaway => self.amount, // Fixed prize amount for giveaways
        };
        let fee_amount = total_amount * fee_percentage as u64 / 100;
        let winner_amount = total_amount - fee_amount;
        (winner_amount, fee_amount)
    }

    // Validation helpers for constraints
    pub fn is_creator(&self, creator: &Pubkey) -> bool {
        self.creator == *creator
    }

    pub fn is_not_full(&self) -> bool {
        self.player_count < self.max_players
    }

    pub fn is_valid_players_count(max_players: u16, min_players: u16, oracle_max: u16) -> bool {
        max_players <= oracle_max && min_players <= max_players
    }

    pub fn is_valid_game_type_players(
        game_type: GameType,
        max_players: u16,
        min_players: u16,
    ) -> bool {
        match game_type {
            GameType::Coinflip => max_players >= 2 && min_players >= 2,
            GameType::Giveaway => max_players >= 1 && min_players >= 1,
        }
    }

    pub fn can_join_private(&self, authority: Option<&Signer>, oracle_authority: &Pubkey) -> bool {
        !self.is_private || authority.map_or(false, |signer| signer.key() == *oracle_authority)
    }

    pub fn has_sufficient_balance_for_join(&self, token_balance: u64, player_balance: u64) -> bool {
        self.game_type == GameType::Giveaway || token_balance + player_balance >= self.amount
    }

    // Checks if the game has no active participants that would prevent cancellation
    // Returns true if: no players or giveaway type
    pub fn has_no_active_participants(&self) -> bool {
        self.player_count == 0 || self.game_type == GameType::Giveaway
    }

    // Checks if the specified authority is allowed to cancel/unjoin (creator or oracle)
    pub fn is_cancellable_by(&self, authority: &Pubkey, oracle_authority: &Pubkey) -> bool {
        *authority == self.creator || *authority == *oracle_authority
    }

    // Checks if the timing allows for cancellation/unjoining
    // Returns true if: game not ready for oracle OR oracle buffer time has passed
    pub fn is_within_cancellation_window(
        &self,
        oracle_buffer_time: u16,
        current_time: i64,
    ) -> bool {
        !self.ready_for_oracle(current_time) || self.buffer_passed(oracle_buffer_time, current_time)
    }
}
