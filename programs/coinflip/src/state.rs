use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{transfer, Transfer};

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

// discriminator (8) + operator (32) + fee_percentage (1) +
// oracle_buffer_time (u64: 8) + max_tickets (u32: 4) +
// max_timeout (u64: 8) + min_timeout (u64: 8) + filter_cleanup_buffer (u64: 8)
pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 8 + 4 + 8 + 8 + 8;

// =============================================================================
// BLOOM FILTER CONSTANTS
// =============================================================================

/// Number of bits in each bloom filter (512 bits = 64 bytes)
pub const BLOOM_FILTER_BITS: usize = 512;
/// Number of u64 words in each bloom filter (512 bits / 64 bits per word)
pub const BLOOM_FILTER_WORDS: usize = 8;
/// Size of entropy window for winner calculation (8 bytes for u64)
pub const ENTROPY_WINDOW_SIZE: usize = 8;
/// Maximum number of entropy windows that fit in a 32-byte hash
pub const MAX_ENTROPY_WINDOWS: usize = 32 - ENTROPY_WINDOW_SIZE;

// =============================================================================
// PDA SEED CONSTANTS
// =============================================================================

/// Seed for Oracle PDA
pub const ORACLE_SEED: &[u8] = b"oracle";
/// Seed for Game PDA
pub const GAME_SEED: &[u8] = b"game";
/// Seed for GameToken PDA
pub const GAME_TOKEN_SEED: &[u8] = b"game_token";
/// Seed for Game Vault PDA
pub const GAME_VAULT_SEED: &[u8] = b"game_vault";

// =============================================================================
// GAME CONSTANTS
// =============================================================================

/// Minimum players required for competitive games (Coinflip/Dumbflip)
pub const MIN_COMPETITIVE_PLAYERS: u32 = 2;
/// Minimum players required for giveaway games (Giveaway/Dumbaway)
pub const MIN_GIVEAWAY_PLAYERS: u32 = 1;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
// PLAYER_GAMES_SIZE removed along with PlayerGames account
pub const GAME_FIXED_SIZE: usize = 8
    + 32  // creator
    + 1   // game_type
    + 8   // ticket_amount
    + 4   // max_tickets
    + 4   // min_tickets
    + 4   // tickets_count
    + 32  // token_mint
    + 8   // created_at
    + 8   // timeout (u64)
    + 8   // last_slot
    + 1   // is_private
    + 8   // total_amount
    + 64  // participants_filter (8 * u64)
    + 4;  // participant_hashes vec length prefix


// =============================================================================
// GAME TYPES
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
#[repr(u8)]
pub enum GameType {
    /// Two or more players compete for the pot
    Coinflip,
    /// Two or more players compete for the pot, reveal winner in real-time
    Dumbflip,
    /// One or more players compete for a giveaway from the creator
    Giveaway,
    /// One or more players compete for a giveaway from the creator, reveal winner in real-time
    Dumbaway,
    /// Multi-join, no unjoin, accumulating pot
    Snowball,
    /// Multi-join, no unjoin, accumulating pot, reveal winner in real-time
    Dumbball,
}

impl Default for GameType {
    fn default() -> Self {
        GameType::Coinflip
    }
}

// =============================================================================
// ORACLE ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct Oracle {
    /// Operator that can update oracle settings and claim fees
    pub operator: Pubkey,
    /// Percentage of game amount taken as fee (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout before cancellation is allowed
    pub oracle_buffer_time: u64,
    /// Maximum number of tickets allowed in a game
    pub max_tickets: u32,
    /// Maximum timeout duration in seconds for a game
    pub max_timeout: u64,
    /// Minimum timeout duration in seconds for a game
    pub min_timeout: u64,
    /// Additional buffer time for filter cleanup after oracle buffer expires
    pub filter_cleanup_buffer: u64,
}

impl Oracle {
    /// Updates oracle configuration with new values
    pub fn update_config(
        &mut self,
        fee_percentage: u8,
        oracle_buffer_time: u64,
        max_tickets: u32,
        max_timeout: u64,
        min_timeout: u64,
        filter_cleanup_buffer: u64,
        new_operator: Pubkey,
    ) {
        self.fee_percentage = fee_percentage;
        self.oracle_buffer_time = oracle_buffer_time;
        self.max_tickets = max_tickets;
        self.max_timeout = max_timeout;
        self.min_timeout = min_timeout;
        self.filter_cleanup_buffer = filter_cleanup_buffer;
        self.operator = new_operator;
    }

    /// Checks if given operator matches oracle operator
    pub fn is_authorized_operator(&self, operator: &Pubkey) -> bool {
        self.operator == *operator
    }

    /// Validates timeout is within oracle's allowed range
    pub fn is_valid_timeout_range(&self, timeout: u64) -> bool {
        timeout >= self.min_timeout && timeout <= self.max_timeout
    }

    /// Validates fee percentage is within valid range (0-100)
    pub fn is_valid_fee_percentage(&self, fee_percentage: u8) -> bool {
        fee_percentage <= 100
    }

    /// Validates timeout parameters are in correct order
    pub fn is_valid_timeout(&self, max_timeout: u64, min_timeout: u64) -> bool {
        max_timeout >= min_timeout
    }

    /// Validates ticket count is positive
    pub fn is_valid_tickets_count(&self, max_tickets: u32) -> bool {
        max_tickets > 0
    }

    /// Gets total buffer time including filter cleanup buffer
    pub fn get_total_buffer_time(&self) -> u64 {
        self.oracle_buffer_time + self.filter_cleanup_buffer
    }
}

// =============================================================================
// GAME TOKEN ACCOUNT
// =============================================================================

#[account]
#[derive(Default)]
pub struct GameToken {
    /// Token mint for this game token configuration
    pub token_mint: Pubkey,
    /// Vault bump seed for PDA token transfers
    pub vault_bump: u8,
    /// Minimum amount required to participate in games
    pub min_amount: u64,
    /// Accumulated fee amount for this token
    pub fee_amount: u64,
    /// Whether this token is enabled for games
    pub enabled: bool,
}

impl GameToken {
    /// Updates token configuration with new values
    pub fn update_config(&mut self, min_amount: u64, enabled: bool) {
        self.min_amount = min_amount;
        self.enabled = enabled;
    }

    /// Initializes token configuration for new token
    pub fn initialize(
        &mut self,
        token_mint: Pubkey,
        vault_bump: u8,
        min_amount: u64,
        enabled: bool,
    ) {
        self.token_mint = token_mint;
        self.vault_bump = vault_bump;
        self.min_amount = min_amount;
        self.fee_amount = 0;
        self.enabled = enabled;
    }

    /// Checks if token is enabled for games
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Validates amount meets minimum requirement
    pub fn meets_min_amount(&self, amount: u64) -> bool {
        amount >= self.min_amount
    }

    /// Generalized token transfer helper (reduces duplication of PDA vs player authority logic)
    /// If `use_pda_signer` is true, signs the CPI with the game vault PDA seeds.
    pub fn handle_token_transfer<'info>(
        &self,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>, // player or PDA
        token_program: AccountInfo<'info>,
        amount: u64,
        use_pda_signer: bool,
    ) -> Result<()> {
        if use_pda_signer {
            let signer_seeds = &[b"game_vault", self.token_mint.as_ref(), &[self.vault_bump]];
            transfer(
                CpiContext::new_with_signer(
                    token_program,
                    Transfer { from, to, authority },
                    &[signer_seeds],
                ),
                amount,
            )?;
        } else {
            transfer(
                CpiContext::new(
                    token_program,
                    Transfer { from, to, authority },
                ),
                amount,
            )?;
        }
        Ok(())
    }
}

// =============================================================================
// BLOOM FILTER STRUCTURES
// =============================================================================

/// Simplified bloom filter structure (removed redundant game_filter)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct BloomFilters {
    /// 512-bit bloom filter for game + ticket index tracking
    pub game_index_filter: [u64; 8],
    /// 512-bit bloom filter for game + ticket index unjoin tracking
    pub unjoin_index_filter: [u64; 8],
}

// PlayerGames account removed in simplified version
// =============================================================================
// GAME ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct Game {
    /// Creator of the game
    pub creator: Pubkey,
    /// Type of game being played
    pub game_type: GameType,
    /// Amount each player must contribute
    pub ticket_amount: u64,
    /// Maximum number of tickets allowed
    pub max_tickets: u32,
    /// Minimum number of tickets required
    pub min_tickets: u32,
    /// Current number of tickets (total participations)
    pub tickets_count: u32,
    /// Token mint used for this game
    pub token_mint: Pubkey,
    /// Timestamp when game was created
    pub created_at: u64,
    /// Timeout duration in seconds
    pub timeout: u64,
    /// Last slot when any player action occurred
    pub last_slot: u64,
    /// Whether this is a private game requiring oracle approval
    pub is_private: bool,
    /// Total accumulated prize
    pub total_amount: u64,
    /// 512-bit bloom filter for this game's participants (probabilistic)
    pub participants_filter: [u64; 8],
    /// Exact participant hash list (first 8 bytes of SHA256(pubkey)) to eliminate false positives
    pub participant_hashes: Vec<u64>,
}

impl Game {
    // =============================================================================
    // CORE GAME LIFECYCLE METHODS
    // =============================================================================

    /// Checks if the game has exceeded its timeout duration
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.created_at + self.timeout
    }

    /// Checks if the game meets requirements to be completed by oracle
    pub fn is_ready_for_completion(&self, current_time: u64) -> bool {
        let has_min_tickets = self.tickets_count >= self.min_tickets;
        let has_max_tickets = self.tickets_count == self.max_tickets;
        let timeout_reached = self.is_expired(current_time);

        // Game is ready if it has max tickets OR (min tickets AND timeout reached)
        has_max_tickets || (has_min_tickets && timeout_reached)
    }

    /// Checks if oracle buffer time has expired (game is no longer completable)
    pub fn is_buffer_expired(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        let expires_at = self.created_at + self.timeout as u64;
        current_time >= expires_at + oracle_buffer_time
    }

    /// Checks if the game is waiting for oracle to complete it
    pub fn waiting_for_oracle(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        // If game is already completed, no need to wait for oracle
        if self.total_amount == 0 {
            return false;
        }

        self.is_ready_for_completion(current_time)
            && !self.is_buffer_expired(oracle_buffer_time, current_time)
    }

    /// Calculate when this game will expire (for bloom filter tracking)
    pub fn calculate_expiry_timestamp(&self, total_buffer_time: u64) -> u64 {
        self.created_at + self.timeout + total_buffer_time
    }

    /// Marks the game as completed by setting total_amount to zero
    pub fn complete(&mut self) {
        self.total_amount = 0;
    }

    /// Verifies the secret key matches the random hash using SHA256
    pub fn verify_secret_key(random_hash: [u8; 32], secret_key: [u8; 32]) -> bool {
        let random_hash_calculated = hash(secret_key.as_ref()).to_bytes();
        random_hash_calculated == random_hash
    }

    /// Calculates the winner index using secret key with unbiased random selection
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> Option<u32> {
        // Use total tickets count for all game types
        let n_entries = self.tickets_count as u64;

        if n_entries == 1 {
            return Some(0);
        }

        // Use stack-allocated array instead of Vec for better performance
        let mut combined_data = [0u8; 40]; // 32 bytes (secret) + 8 bytes (slot)
        combined_data[..32].copy_from_slice(&secret_key);
        combined_data[32..].copy_from_slice(&self.last_slot.to_le_bytes());
        let entropy_hash = hash(&combined_data).to_bytes();

        // Try sliding entropy windows through the hashed entropy using constants
        let max_valid = u64::MAX - (u64::MAX % n_entries);
        for start_pos in 0..=MAX_ENTROPY_WINDOWS {
            let random_u64 = u64::from_le_bytes(
                entropy_hash[start_pos..start_pos + ENTROPY_WINDOW_SIZE]
                    .try_into()
                    .unwrap(),
            );

            // Use this value if it's in the unbiased range
            if random_u64 < max_valid {
                return Some((random_u64 % n_entries) as u32);
            }
        }

        // Return None if unable to generate unbiased random number
        None
    }

    /// Calculates prize distribution with fee deduction
    pub fn calculate_amounts(&self, fee_percentage: u64) -> (u64, u64) {
        // Use u128 for intermediate calculation to prevent overflow
        let fee_amount = (self.total_amount as u128 * fee_percentage as u128 / 100) as u64;
        let winner_amount = self.total_amount - fee_amount;
        (winner_amount, fee_amount)
    }

    /// Validation helpers for account constraints
    pub fn is_creator(&self, creator: &Pubkey) -> bool {
        self.creator == *creator
    }

    pub fn is_not_full(&self) -> bool {
        self.tickets_count < self.max_tickets
    }

    // =============================================================================
    // PLAYER PARTICIPATION TRACKING
    // =============================================================================

    /// Add player to the game and update counters (no bloom filter)
    pub fn add_player_to_game(&mut self) -> Result<()> {
        // Update counters only
        self.tickets_count += 1;
        self.total_amount += self.ticket_amount;

        Ok(())
    }

    // =============================================================================
    // GAME-LEVEL BLOOM FILTER METHODS (SAFETY REDUNDANCY)
    // =============================================================================

    /// Generate hash values for player participation in this game's bloom filter
    pub fn hash_participant(player_key: &Pubkey) -> (usize, usize, usize) {
        // Single hash operation with offset-based position calculation for efficiency
        let player_data = player_key.to_bytes();
        let hash_result = hash(&player_data).to_bytes();

        // Extract three positions from single hash (more efficient than multiple hash operations)
        let pos1 = (u64::from_le_bytes(hash_result[0..8].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos2 = (u64::from_le_bytes(hash_result[8..16].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos3 = (u64::from_le_bytes(hash_result[16..24].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;

        (pos1, pos2, pos3)
    }

    /// Helper to set bits in this game's participants filter
    pub fn set_participant_bits(&mut self, positions: (usize, usize, usize)) {
        let (pos1, pos2, pos3) = positions;
        self.participants_filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        self.participants_filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        self.participants_filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    /// Add participant to this game's bloom filter (safety redundancy)
    pub fn add_participant_to_filter(&mut self, player_key: &Pubkey) {
        let positions = Self::hash_participant(player_key);
        self.set_participant_bits(positions);
    }

    /// Helper to check bits in this game's participants filter
    pub fn check_participant_bits(&self, positions: (usize, usize, usize)) -> bool {
        let (pos1, pos2, pos3) = positions;
        let bit1_set = (self.participants_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let bit2_set = (self.participants_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let bit3_set = (self.participants_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        bit1_set && bit2_set && bit3_set
    }

    /// Check if participant is likely in this game's bloom filter (safety check)
    pub fn check_participant_in_filter(&self, player_key: &Pubkey) -> bool {
        let positions = Self::hash_participant(player_key);
        self.check_participant_bits(positions)
    }

    // =============================================================================
    // VALIDATION HELPERS
    // =============================================================================

    pub fn is_valid_tickets_count(max_tickets: u32, min_tickets: u32, oracle_max: u32) -> bool {
        max_tickets <= oracle_max && min_tickets <= max_tickets
    }

    pub fn is_valid_game_type_tickets(
        game_type: GameType,
        max_tickets: u32,
        min_tickets: u32,
    ) -> bool {
        if game_type == GameType::Giveaway || game_type == GameType::Dumbaway {
            max_tickets >= MIN_GIVEAWAY_PLAYERS && min_tickets >= MIN_GIVEAWAY_PLAYERS
        } else {
            max_tickets >= MIN_COMPETITIVE_PLAYERS && min_tickets >= MIN_COMPETITIVE_PLAYERS
        }
    }

    // =============================================================================
    // PLAYER PARTICIPATION METHODS
    // =============================================================================

    pub fn can_join_private(
        &self,
        passed_operator: Option<&Signer>,
        oracle_operator: &Pubkey,
    ) -> bool {
        !self.is_private || passed_operator.map_or(false, |signer| signer.key() == *oracle_operator)
    }

    pub fn has_sufficient_balance_for_join(&self, token_balance: u64) -> bool {
        self.game_type == GameType::Giveaway
            || self.game_type == GameType::Dumbaway
            || token_balance >= self.ticket_amount
    }
}
