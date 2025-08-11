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
/// Seed for PlayerGames PDA
pub const PLAYER_GAMES_SEED: &[u8] = b"player_games";

// =============================================================================
// GAME CONSTANTS
// =============================================================================

/// Minimum players required for competitive games (Coinflip/Dumbflip)
pub const MIN_COMPETITIVE_PLAYERS: u32 = 2;
/// Minimum players required for giveaway games (Giveaway/Dumbaway)
pub const MIN_GIVEAWAY_PLAYERS: u32 = 1;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
pub const PLAYER_GAMES_SIZE: usize = 8        // discriminator
    + 1     // active_filter_index (u8)
    + 128   // filter_a (BloomFilters: 2 x [u64; 8] = 2 x 64 bytes)
    + 8     // filter_a_last_updated (u64)
    + 8     // filter_a_longest_expiry (u64)
    + 128   // filter_b (BloomFilters: 2 x [u64; 8] = 2 x 64 bytes)
    + 8     // filter_b_last_updated (u64)
    + 8     // filter_b_longest_expiry (u64)
    + 8     // filter_cleaning_scheduled_at (u64)
    + 1     // emergency_unjoin_mode (bool)
    + 87; // padding for memory alignment (Rust struct alignment)
pub const GAME_BASE_SIZE: usize = 8
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
;

// =============================================================================
// GAME TYPES
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
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

    /// Handles PDA-signed token transfers from game vault
    pub fn handle_pda_token_transfer<'info>(
        &self,
        from_account: AccountInfo<'info>,
        to_account: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let signer_seeds = &[b"game_vault", self.token_mint.as_ref(), &[self.vault_bump]];

        transfer(
            CpiContext::new_with_signer(
                token_program,
                Transfer {
                    from: from_account,
                    to: to_account,
                    authority,
                },
                &[signer_seeds],
            ),
            amount,
        )?;

        Ok(())
    }

    /// Handles direct token transfer from player wallet to game vault
    pub fn handle_player_token_transfer<'info>(
        &self,
        amount: u64,
        player_token_account: AccountInfo<'info>,
        game_token_account: AccountInfo<'info>,
        player: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
    ) -> Result<()> {
        transfer(
            CpiContext::new(
                token_program,
                Transfer {
                    from: player_token_account,
                    to: game_token_account,
                    authority: player,
                },
            ),
            amount,
        )?;

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

// =============================================================================
// PLAYER GAMES ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct PlayerGames {
    /// Dual bloom filter system - 0 means filter_a is active, 1 means filter_b is active
    pub active_filter_index: u8,

    /// Filter Set A
    pub filter_a: BloomFilters,
    pub filter_a_last_updated: u64,
    pub filter_a_longest_expiry: u64,

    /// Filter Set B
    pub filter_b: BloomFilters,
    pub filter_b_last_updated: u64,
    pub filter_b_longest_expiry: u64,

    /// Collision Detection & Recovery System
    /// Timestamp when current active filter is scheduled for cleaning
    pub filter_cleaning_scheduled_at: u64,
    /// Whether emergency unjoin mode is active (Game-filter-only validation)
    pub emergency_unjoin_mode: bool,
}

impl PlayerGames {

    /// Get reference to the active filter set
    fn get_active_filter(&self) -> (&BloomFilters, u64, u64) {
        if self.active_filter_index == 0 {
            (
                &self.filter_a,
                self.filter_a_last_updated,
                self.filter_a_longest_expiry,
            )
        } else {
            (
                &self.filter_b,
                self.filter_b_last_updated,
                self.filter_b_longest_expiry,
            )
        }
    }

    /// Get mutable reference to the active filter set
    fn get_active_filter_mut(&mut self) -> (&mut BloomFilters, &mut u64, &mut u64) {
        if self.active_filter_index == 0 {
            (
                &mut self.filter_a,
                &mut self.filter_a_last_updated,
                &mut self.filter_a_longest_expiry,
            )
        } else {
            (
                &mut self.filter_b,
                &mut self.filter_b_last_updated,
                &mut self.filter_b_longest_expiry,
            )
        }
    }

    /// Get reference to the inactive filter set
    fn get_inactive_filter(&self) -> (&BloomFilters, u64, u64) {
        if self.active_filter_index == 1 {
            (
                &self.filter_a,
                self.filter_a_last_updated,
                self.filter_a_longest_expiry,
            )
        } else {
            (
                &self.filter_b,
                self.filter_b_last_updated,
                self.filter_b_longest_expiry,
            )
        }
    }

    // =============================================================================
    // BLOOM FILTER HELPER FUNCTIONS (ELIMINATES CODE DUPLICATION)
    // =============================================================================

    /// Generic helper to check bloom filter bits - eliminates code duplication
    fn check_filter_bits(
        filter: &[u64; BLOOM_FILTER_WORDS],
        positions: (usize, usize, usize),
    ) -> bool {
        let (pos1, pos2, pos3) = positions;
        let bit1_set = (filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let bit2_set = (filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let bit3_set = (filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        bit1_set && bit2_set && bit3_set
    }

    /// Generic helper to set bloom filter bits - eliminates code duplication
    fn set_filter_bits(filter: &mut [u64; BLOOM_FILTER_WORDS], positions: (usize, usize, usize)) {
        let (pos1, pos2, pos3) = positions;
        filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    // =============================================================================
    // HASH GENERATION FUNCTIONS (OPTIMIZED)
    // =============================================================================

    /// Generate hash values for basic game participation (no index)
    fn hash_game_participation(game_key: &Pubkey) -> (usize, usize, usize) {
        // Use single hash operation with offset-based position calculation for efficiency
        let game_data = game_key.to_bytes();
        let hash_result = hash(&game_data).to_bytes();

        // Extract three positions from single hash (more efficient than multiple hash operations)
        let pos1 = (u64::from_le_bytes(hash_result[0..8].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos2 = (u64::from_le_bytes(hash_result[8..16].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos3 = (u64::from_le_bytes(hash_result[16..24].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;

        (pos1, pos2, pos3)
    }

    /// Generate hash values for game key + index bloom filter
    fn hash_game_index(game_key: &Pubkey, ticket_index: u32) -> (usize, usize, usize) {
        // Use stack-allocated array instead of Vec allocation for better performance
        let mut combined_data = [0u8; 36]; // 32 bytes (Pubkey) + 4 bytes (u32)
        combined_data[..32].copy_from_slice(&game_key.to_bytes());
        combined_data[32..].copy_from_slice(&ticket_index.to_le_bytes());

        // Single hash operation with offset-based position calculation
        let hash_result = hash(&combined_data).to_bytes();

        // Extract three positions from single hash (more efficient)
        let pos1 = (u64::from_le_bytes(hash_result[0..8].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos2 = (u64::from_le_bytes(hash_result[8..16].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;
        let pos3 = (u64::from_le_bytes(hash_result[16..24].try_into().unwrap())
            % BLOOM_FILTER_BITS as u64) as usize;

        (pos1, pos2, pos3)
    }

    /// Set bits in bloom filter for a game key (writes to active filter set)
    /// Uses game participation hash (no index) to track basic game participation
    fn set_bloom_bits(&mut self, game_key: &Pubkey) {
        let (pos1, pos2, pos3) = Self::hash_game_participation(game_key);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter using helper function
        Self::set_filter_bits(&mut active_filter.game_index_filter, (pos1, pos2, pos3));
    }

    /// Set bits in game index bloom filter for a game key + index (writes to active filter set)
    fn set_game_index_bits(&mut self, game_key: &Pubkey, ticket_index: u32) {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter using helper function
        Self::set_filter_bits(&mut active_filter.game_index_filter, (pos1, pos2, pos3));
    }

    /// Set bits in unjoin index bloom filter for a game key + index (writes to active filter set)
    fn set_unjoin_index_bits(&mut self, game_key: &Pubkey, ticket_index: u32) {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter (8 x 64-bit words)
        Self::set_filter_bits(&mut active_filter.unjoin_index_filter, (pos1, pos2, pos3));
    }

    /// Check if bits are set in bloom filter for a game key (checks both filter sets)
    /// Uses game participation hash (no index) to track basic game participation
    fn check_bloom_bits(&self, game_key: &Pubkey) -> bool {
        let positions = Self::hash_game_participation(game_key);
        Self::check_filter_bits(&self.filter_a.game_index_filter, positions)
            || Self::check_filter_bits(&self.filter_b.game_index_filter, positions)
    }

    /// Check if bits are set in game index bloom filter for a game key + index (checks both filter sets)
    fn check_game_index_bits(&self, game_key: &Pubkey, ticket_index: u32) -> bool {
        let positions = Self::hash_game_index(game_key, ticket_index);
        Self::check_filter_bits(&self.filter_a.game_index_filter, positions)
            || Self::check_filter_bits(&self.filter_b.game_index_filter, positions)
    }

    /// Check if bits are set in unjoin index bloom filter for a game key + index (checks both filter sets)
    fn check_unjoin_index_bits(&self, game_key: &Pubkey, ticket_index: u32) -> bool {
        let positions = Self::hash_game_index(game_key, ticket_index);
        Self::check_filter_bits(&self.filter_a.unjoin_index_filter, positions)
            || Self::check_filter_bits(&self.filter_b.unjoin_index_filter, positions)
    }

    /// Check if player likely joined this game (bloom filter check)
    fn likely_joined_game(&self, game_key: &Pubkey) -> bool {
        self.check_bloom_bits(game_key)
    }

    /// Basic join check - dual bloom filter + timestamp protection (without collision detection)
    /// Used for internal validation where collision detection is not needed
    pub fn basic_can_join_game(&self, game_key: &Pubkey, game_created_time: u64) -> bool {
        // Check both filter sets' timestamps
        let (_, active_last_updated, _) = self.get_active_filter();
        let (_, inactive_last_updated, _) = self.get_inactive_filter();

        // If game was created AFTER both filters were last updated,
        // it can't possibly be in either filter (even if bits match)
        if game_created_time > active_last_updated && game_created_time > inactive_last_updated {
            return true; // Definitely can join
        }

        // Game might be in filters, check bloom filter
        !self.likely_joined_game(game_key)
    }

    /// Basic mark_game_joined - core functionality without collision detection extras
    fn basic_mark_game_joined(
        &mut self,
        game_key: &Pubkey,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Add to active bloom filter for tracking
        self.set_bloom_bits(game_key);

        // Update timestamps for active filter set
        let (_, filter_last_updated, longest_game_expiry) = self.get_active_filter_mut();
        *filter_last_updated = current_time;

        // Keep the LONGEST expiration time for active filter set
        if *longest_game_expiry == 0 {
            *longest_game_expiry = game_expiry_time;
        } else {
            *longest_game_expiry = (*longest_game_expiry).max(game_expiry_time);
        }
    }



    /// Mark game + index as joined in active bloom filter
    pub fn mark_game_index_joined(
        &mut self,
        game_key: &Pubkey,
        ticket_index: u32,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Add to active game index bloom filter
        self.set_game_index_bits(game_key, ticket_index);

        // Update timestamps for active filter set
        let (_, filter_last_updated, longest_game_expiry) = self.get_active_filter_mut();
        *filter_last_updated = current_time;

        // Keep the LONGEST expiration time for active filter set
        if *longest_game_expiry == 0 {
            *longest_game_expiry = game_expiry_time;
        } else {
            *longest_game_expiry = (*longest_game_expiry).max(game_expiry_time);
        }
    }

    /// Check if player can join game with specific index (dual bloom filter + timestamp protection)
    pub fn can_join_with_index(
        &self,
        game_key: &Pubkey,
        ticket_index: u32,
        game_created_time: u64,
    ) -> bool {
        // Check both filter sets' timestamps
        let (_, active_last_updated, _) = self.get_active_filter();
        let (_, inactive_last_updated, _) = self.get_inactive_filter();

        // If game was created AFTER both filters were last updated,
        // it can't possibly be in either filter (even if bits match)
        if game_created_time > active_last_updated && game_created_time > inactive_last_updated {
            return true; // Definitely can join
        }

        // Game might be in filters, check bloom filter
        !self.check_game_index_bits(game_key, ticket_index)
    }

    /// Mark game + index as unjoined in active bloom filter
    pub fn mark_game_index_unjoined(
        &mut self,
        game_key: &Pubkey,
        ticket_index: u32,
        current_time: u64,
    ) {
        // Add to active unjoin index bloom filter
        self.set_unjoin_index_bits(game_key, ticket_index);

        // Update timestamp for active filter set
        let (_, filter_last_updated, _) = self.get_active_filter_mut();
        *filter_last_updated = current_time;
    }

    /// Check if player has already unjoined this specific game + index
    pub fn has_unjoined_game_index(
        &self,
        game_key: &Pubkey,
        ticket_index: u32,
        game_created_time: u64,
    ) -> bool {
        // Check both filter sets' timestamps
        let (_, active_last_updated, _) = self.get_active_filter();
        let (_, inactive_last_updated, _) = self.get_inactive_filter();

        // If game was created AFTER both filters were last updated,
        // it can't possibly be in either filter (even if bits match)
        if game_created_time > active_last_updated && game_created_time > inactive_last_updated {
            return false; // Definitely hasn't unjoined
        }

        // Game might be in filters, check unjoin bloom filter
        self.check_unjoin_index_bits(game_key, ticket_index)
    }

    // =============================================================================
    // COLLISION DETECTION & RECOVERY SYSTEM
    // =============================================================================

    /// Main entry point: Check if player can join game with collision detection and filter switching
    pub fn can_join_game(
        &mut self,
        game_key: &Pubkey,
        player_key: &Pubkey,
        game: &crate::state::Game,
        oracle: &crate::state::Oracle,
        current_time: u64,
    ) -> bool {
        // First, check if emergency unjoin mode is active and should be deactivated
        self.maybe_deactivate_emergency_mode(oracle, current_time);

        // Fast path: Check if player can definitely join without collision detection
        if self.has_basic_join_permission(game_key, game.created_at) {
            return true;
        }

        // Slow path: Handle potential collision through cross-validation
        self.handle_potential_collision(player_key, game, oracle, current_time)
    }

    /// Fast path: Check if player can join without complex collision detection
    fn has_basic_join_permission(&self, game_key: &Pubkey, game_created_time: u64) -> bool {
        self.basic_can_join_game(game_key, game_created_time)
    }

    /// Slow path: Handle potential bloom filter collision through cross-validation
    fn handle_potential_collision(
        &mut self,
        player_key: &Pubkey,
        game: &crate::state::Game,
        oracle: &crate::state::Oracle,
        current_time: u64,
    ) -> bool {
    // Cross-validate PlayerGames filter against Game filter
        let collision_detected = self.detect_filter_collision(player_key, game);

        if collision_detected {
            // Attempt to resolve collision by switching filters
            self.handle_collision_detected(game, oracle, current_time)
        } else {
            false // Legitimate double-join attempt - reject
        }
    }

    /// Detect if there's a collision between PlayerGames and Game filters
    fn detect_filter_collision(&self, player_key: &Pubkey, game: &crate::state::Game) -> bool {
        let in_game_filter = game.check_participant_in_filter(player_key);
        let (_, active_last_updated, _) = self.get_active_filter();
        let filter_older_than_game = active_last_updated < game.created_at;

        // Collision detected if:
        // 1. Player NOT in Game filter (different game collision), OR
    // 2. PlayerGames filter was updated BEFORE this game was created (temporal collision)
        !in_game_filter || filter_older_than_game
    }

    /// Handle detected collision by switching filters and scheduling cleaning
    /// Returns true if collision was resolved, false if it couldn't be handled
    fn handle_collision_detected(
        &mut self,
        game: &crate::state::Game,
        oracle: &crate::state::Oracle,
        current_time: u64,
    ) -> bool {
        // Check if there's already a pending cleanup that hasn't completed
        if self.filter_cleaning_scheduled_at > 0 && current_time < self.filter_cleaning_scheduled_at
        {
            return false; // Cannot resolve collision right now
        }

        // Calculate when it's safe to clean the current active filter
        let game_expiry = game.calculate_expiry_timestamp(oracle.get_total_buffer_time());
        let safety_buffer = oracle.filter_cleanup_buffer;
        let (_, _, active_longest_expiry) = self.get_active_filter();
        let cleaning_time = active_longest_expiry.max(game_expiry) + safety_buffer;

        // Schedule current active filter for cleaning
        self.filter_cleaning_scheduled_at = cleaning_time;

        // Switch to inactive filter immediately
        self.active_filter_index = 1 - self.active_filter_index;

        // Reset the new active filter (previously inactive)
        let (new_active_filter, new_last_updated, new_longest_expiry) =
            self.get_active_filter_mut();
        *new_active_filter = BloomFilters::default();
        *new_last_updated = current_time;
        *new_longest_expiry = 0;

        // Collision detection state is reset by clearing the new active filter above

        true // Collision successfully resolved
    }

    /// Check if emergency unjoin mode should be activated
    pub fn maybe_activate_emergency_mode(&mut self, current_time: u64) {
        if !self.emergency_unjoin_mode
            && self.filter_cleaning_scheduled_at > 0
            && current_time >= self.filter_cleaning_scheduled_at
        {
            self.emergency_unjoin_mode = true;
        }
    }

    /// Check if emergency unjoin mode should be deactivated (after sufficient time has passed)
    fn maybe_deactivate_emergency_mode(
        &mut self,
        oracle: &crate::state::Oracle,
        current_time: u64,
    ) {
        if self.emergency_unjoin_mode {
            // Use the user-configured filter cleanup buffer for deactivation timing
            let deactivation_time =
                self.filter_cleaning_scheduled_at + oracle.filter_cleanup_buffer;

            if current_time >= deactivation_time {
                self.emergency_unjoin_mode = false;
                self.filter_cleaning_scheduled_at = 0; // Reset cleaning schedule
            }
        }
    }

    /// Main entry point: Mark game as joined with collision detection integration
    pub fn mark_game_joined(
        &mut self,
        game_key: &Pubkey,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Update max expiry tracking for collision detection (using existing longest_expiry field)
        let (_, _, active_longest_expiry) = self.get_active_filter_mut();
        *active_longest_expiry = (*active_longest_expiry).max(game_expiry_time);

        // Call basic mark_game_joined logic
        self.basic_mark_game_joined(game_key, game_expiry_time, current_time);
    }

    /// Main entry point: Check if player can unjoin game with emergency mode support
    pub fn can_unjoin_game(
        &self,
        game_key: &Pubkey,
        player_key: &Pubkey,
        ticket_index: u32,
        game: &crate::state::Game,
    ) -> bool {
        // In emergency mode, only check Game filter (more permissive)
        if self.emergency_unjoin_mode {
            let in_game_filter = game.check_participant_in_filter(player_key);
            return in_game_filter;
        }

    // Normal mode: use standard PlayerGames filter validation
        let already_joined = !self.can_join_with_index(game_key, ticket_index, game.created_at);
        let not_already_unjoined =
            !self.has_unjoined_game_index(game_key, ticket_index, game.created_at);

        already_joined && not_already_unjoined
    }
}

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
    /// 512-bit bloom filter for this game's participants (safety redundancy) - same size as PlayerGames filters
    pub participants_filter: [u64; 8],
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
    fn hash_participant(player_key: &Pubkey) -> (usize, usize, usize) {
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
    fn set_participant_bits(&mut self, positions: (usize, usize, usize)) {
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
    fn check_participant_bits(&self, positions: (usize, usize, usize)) -> bool {
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
