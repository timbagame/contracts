use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

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

// Game token configuration for supported tokens
#[account]
#[derive(Default)]
pub struct GameToken {
    // The token mint address
    pub token_mint: Pubkey,
    // Minimum amount required to participate in games
    pub min_amount: u64,
    // Accumulated fee amount for this token
    pub fee_amount: u64,
    // Whether this token is enabled for games
    pub enabled: bool,
}

// Player's balance for a specific token
#[account]
#[derive(Default)]
pub struct PlayerBalance {
    // Player's public key
    pub player: Pubkey,
    // Token mint address
    pub token_mint: Pubkey,
    // Current balance amount
    pub amount: u64,
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

// Current status of a game
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameStatus {
    // Game is active and accepting players
    Active,
    // Game has been completed and winner determined
    Completed,
    // Game has been cancelled
    Cancelled,
}

impl Default for GameStatus {
    fn default() -> Self {
        GameStatus::Active
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
    // List of players who have joined
    pub players: Vec<Pubkey>,
    // Winner of the game (if completed)
    pub winner: Pubkey,
    // Current status of the game
    pub status: GameStatus,
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
    // Checks if the game is ready for oracle to determine winner
    pub fn ready_for_oracle(&self, current_time: i64) -> bool {
        let has_min_players = self.players.len() >= self.min_players as usize;
        let has_max_players = self.players.len() == self.max_players as usize;
        let timeout_met = current_time as u64 >= self.created_at + self.timeout as u64;

        (has_min_players && timeout_met) || has_max_players
    }

    // Checks if the oracle buffer time has passed
    pub fn buffer_passed(&self, oracle_buffer_time: u16, current_time: i64) -> bool {
        current_time as u64 >= self.created_at + self.timeout as u64 + oracle_buffer_time as u64
    }

    // Derives the PDA for this game using the secret key
    pub fn derive_pda(&self, secret_key: [u8; 64]) -> Pubkey {
        let random_hash = hash(secret_key.as_ref());
        let program_id = crate::ID;
        let (pda, _) = Pubkey::find_program_address(&[b"game", random_hash.as_ref()], &program_id);

        pda
    }

    // Calculates the winner using the secret key
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

    // Calculates the winner amount and fee amount
    pub fn calculate_amounts(&self, players_len: u64, fee_percentage: u8) -> (u64, u64) {
        let total_amount = self.amount * players_len;
        let fee_amount = total_amount * fee_percentage as u64 / 100;
        let winner_amount = total_amount - fee_amount;

        (winner_amount, fee_amount)
    }
}
