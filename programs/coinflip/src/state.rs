use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

// Constants for space calculation
pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 4 + 4 + 4; // discriminator + authority + fee_percentage + oracle_buffer_time + max_players + max_timeout + min_timeout
pub const GAME_TOKEN_SIZE: usize = 8 + 8 + 8 + 1; // discriminator + min_amount + fee_amount + enabled
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8; // discriminator + amount
pub const PLAYER_PARTICIPATION_SIZE: usize = 8 + 4 + 8 + 8; // discriminator + player_index + player_amount + joined_at
pub const GAME_SIZE: usize = 8 + 32 + 1 + 8 + 4 + 4 + 4 + 32 + 8 + 4 + 8 + 1 + 8; // discriminator + creator + game_type + ticket_amount + max_players + min_players + players_count + token_mint + created_at + timeout + last_slot + is_private + total_amount

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
    pub max_players: u32,
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
        max_players: u32,
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

    pub fn is_valid_players_count(&self, max_players: u32) -> bool {
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
}

// Player's participation in a specific game
#[account]
#[derive(Default)]
pub struct PlayerParticipation {
    // Player's position/index in the game (for winner calculation)
    pub player_index: u32,
    // Amount contributed by the player
    pub player_amount: u64,
    // Slot when the player joined the game
    pub joined_at: u64,
}

// Type of game being played
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    // Two or more players compete for the pot
    Coinflip,
    // One or more players compete for a giveaway from the creator
    Giveaway,
    // Two or more players compete for the pot, we reveal the potential winner in real-time
    Dumbflip,
    // Two or more players compete for the pot, we reveal the potential winner in real-time, can join multiple times, no unjoin, pot accumulates
    Snowball,
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
    pub ticket_amount: u64,
    // Maximum number of players allowed
    pub max_players: u32,
    // Minimum number of players required
    pub min_players: u32,
    // Current number of players who have joined
    pub players_count: u32,
    // Token mint used for this game
    pub token_mint: Pubkey,
    // Timestamp when game was created
    pub created_at: u64,
    // Timeout duration in seconds
    pub timeout: u32,
    // Last slot when any player action occurred
    pub last_slot: u64,
    // Whether this is a private game requiring oracle approval
    pub is_private: bool,
    // Total accumulated prize
    pub total_amount: u64,
}

impl Game {
    // Checks if the game is expired
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.created_at + self.timeout as u64
    }

    // Checks if the game meets requirements to be completed
    pub fn is_ready_for_completion(&self, current_time: u64) -> bool {
        let has_min_players = self.players_count >= self.min_players;
        let has_max_players = self.players_count == self.max_players;
        let timeout_reached = self.is_expired(current_time);

        // Game is ready if it has max players OR (min players AND timeout reached)
        has_max_players || (has_min_players && timeout_reached)
    }

    // Checks if oracle buffer time has passed (game is no longer completable)
    pub fn is_buffer_expired(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        let expires_at = self.created_at + self.timeout as u64;
        current_time >= expires_at + oracle_buffer_time
    }

    // Checks if the game is waiting for oracle to complete it
    pub fn waiting_for_oracle(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        self.is_ready_for_completion(current_time)
            && !self.is_buffer_expired(oracle_buffer_time, current_time)
    }

    // Verifies the secret key matches the random hash
    pub fn verify_secret_key(&self, random_hash: [u8; 32], secret_key: [u8; 32]) -> bool {
        let random_hash_calculated = hash(secret_key.as_ref()).to_bytes();
        random_hash_calculated == random_hash
    }

    // Calculates the winner index using secret key revealed by oracle
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> u32 {
        let n_players = self.players_count as u64;
        if n_players == 1 {
            return 0;
        }

        // Hash combination of secret key and last_slot for additional entropy
        let mut combined_data = Vec::with_capacity(40);
        combined_data.extend_from_slice(&secret_key);
        combined_data.extend_from_slice(&self.last_slot.to_le_bytes());
        let entropy_hash = hash(&combined_data).to_bytes();

        // Try sliding 8-byte windows through the hashed entropy
        let max_valid = u64::MAX - (u64::MAX % n_players);
        for start_pos in 0..=(32 - 8) {
            let random_u64 =
                u64::from_le_bytes(entropy_hash[start_pos..start_pos + 8].try_into().unwrap());

            // Use this value if it's in the unbiased range
            if random_u64 < max_valid {
                return (random_u64 % n_players) as u32;
            }
        }

        panic!("Unable to generate unbiased random number - game must be cancelled");
    }

    // Calculates prize distribution with fee deduction
    pub fn calculate_amounts(&self, fee_percentage: u64) -> (u64, u64) {
        let fee_amount = self.total_amount * fee_percentage / 100;
        let winner_amount = self.total_amount - fee_amount;
        (winner_amount, fee_amount)
    }

    // Validation helpers for constraints
    pub fn is_creator(&self, creator: &Pubkey) -> bool {
        self.creator == *creator
    }

    pub fn is_not_full(&self) -> bool {
        self.players_count < self.max_players
    }

    pub fn is_valid_players_count(max_players: u32, min_players: u32, oracle_max: u32) -> bool {
        max_players <= oracle_max && min_players <= max_players
    }

    pub fn is_valid_game_type_players(
        game_type: GameType,
        max_players: u32,
        min_players: u32,
    ) -> bool {
        if game_type == GameType::Giveaway {
            max_players >= 1 && min_players >= 1
        } else {
            max_players >= 2 && min_players >= 2
        }
    }

    pub fn can_join_private(&self, authority: Option<&Signer>, oracle_authority: &Pubkey) -> bool {
        !self.is_private || authority.map_or(false, |signer| signer.key() == *oracle_authority)
    }

    pub fn has_sufficient_balance_for_join(&self, token_balance: u64, player_balance: u64) -> bool {
        self.game_type == GameType::Giveaway || token_balance + player_balance >= self.ticket_amount
    }

    // Checks if the game has no active participants that would prevent cancellation
    // Returns true if: no players or giveaway type
    pub fn has_no_active_participants(&self) -> bool {
        self.players_count == 0 || self.game_type == GameType::Giveaway
    }
}
