use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{transfer, Transfer};

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 4 + 4 + 4 + 2;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8 + 688; // 8 discriminator + 8 lamports + 688 actual data size (including padding)
pub const GAME_BASE_SIZE: usize = 8
    + 32  // creator
    + 1   // game_type
    + 8   // ticket_amount
    + 4   // max_tickets
    + 4   // min_tickets
    + 4   // tickets_count
    + 32  // token_mint
    + 8   // created_at
    + 4   // timeout
    + 8   // last_slot
    + 1   // is_private
    + 8   // total_amount
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
    pub oracle_buffer_time: u16,
    /// Maximum number of tickets allowed in a game
    pub max_tickets: u32,
    /// Maximum timeout duration in seconds for a game
    pub max_timeout: u32,
    /// Minimum timeout duration in seconds for a game
    pub min_timeout: u32,
    /// Additional buffer time for filter cleanup after oracle buffer expires
    pub filter_cleanup_buffer: u16,
}

impl Oracle {
    /// Updates oracle configuration with new values
    pub fn update_config(
        &mut self,
        fee_percentage: u8,
        oracle_buffer_time: u16,
        max_tickets: u32,
        max_timeout: u32,
        min_timeout: u32,
        filter_cleanup_buffer: u16,
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
    pub fn is_valid_timeout_range(&self, timeout: u32) -> bool {
        timeout >= self.min_timeout && timeout <= self.max_timeout
    }

    /// Validates fee percentage is within valid range (0-100)
    pub fn is_valid_fee_percentage(&self, fee_percentage: u8) -> bool {
        fee_percentage <= 100
    }

    /// Validates timeout parameters are in correct order
    pub fn is_valid_timeout(&self, max_timeout: u32, min_timeout: u32) -> bool {
        max_timeout >= min_timeout
    }

    /// Validates ticket count is positive
    pub fn is_valid_tickets_count(&self, max_tickets: u32) -> bool {
        max_tickets > 0
    }

    /// Gets total buffer time including filter cleanup buffer
    pub fn get_total_buffer_time(&self) -> u64 {
        self.oracle_buffer_time as u64 + self.filter_cleanup_buffer as u64
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
}

// =============================================================================
// BLOOM FILTER STRUCTURES
// =============================================================================

/// Simplified bloom filter structure (no metadata, just filters)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct BloomFilters {
    /// 512-bit bloom filter for game participation tracking
    pub game_filter: [u64; 8],
    /// 512-bit bloom filter for game + ticket index tracking
    pub game_index_filter: [u64; 8],
    /// 512-bit bloom filter for game + ticket index unjoin tracking
    pub unjoin_index_filter: [u64; 8],
}

// =============================================================================
// PLAYER BALANCE ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct PlayerBalance {
    /// Current balance amount
    pub amount: u64,
    
    /// Hybrid approach: recent games tracking for high-confidence detection
    pub recent_games: [Pubkey; 8],
    pub recent_games_idx: u8,
    
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
}

impl PlayerBalance {
    /// Adds refund amount to player balance
    pub fn refund(&mut self, amount: u64) {
        self.amount += amount;
    }

    /// Check if a game is in the recent games list (high-confidence check)
    fn is_in_recent_games(&self, game_key: &Pubkey) -> bool {
        self.recent_games.iter().any(|&game| game == *game_key)
    }

    /// Add a game to the recent games list using circular buffer
    fn add_to_recent_games(&mut self, game_key: &Pubkey) {
        self.recent_games[self.recent_games_idx as usize] = *game_key;
        self.recent_games_idx = (self.recent_games_idx + 1) % 8;
    }

    /// Get reference to the active filter set
    fn get_active_filter(&self) -> (&BloomFilters, u64, u64) {
        if self.active_filter_index == 0 {
            (&self.filter_a, self.filter_a_last_updated, self.filter_a_longest_expiry)
        } else {
            (&self.filter_b, self.filter_b_last_updated, self.filter_b_longest_expiry)
        }
    }

    /// Get mutable reference to the active filter set
    fn get_active_filter_mut(&mut self) -> (&mut BloomFilters, &mut u64, &mut u64) {
        if self.active_filter_index == 0 {
            (&mut self.filter_a, &mut self.filter_a_last_updated, &mut self.filter_a_longest_expiry)
        } else {
            (&mut self.filter_b, &mut self.filter_b_last_updated, &mut self.filter_b_longest_expiry)
        }
    }

    /// Get reference to the inactive filter set
    fn get_inactive_filter(&self) -> (&BloomFilters, u64, u64) {
        if self.active_filter_index == 1 {
            (&self.filter_a, self.filter_a_last_updated, self.filter_a_longest_expiry)
        } else {
            (&self.filter_b, self.filter_b_last_updated, self.filter_b_longest_expiry)
        }
    }

    /// Get mutable reference to the inactive filter set
    fn get_inactive_filter_mut(&mut self) -> (&mut BloomFilters, &mut u64, &mut u64) {
        if self.active_filter_index == 1 {
            (&mut self.filter_a, &mut self.filter_a_last_updated, &mut self.filter_a_longest_expiry)
        } else {
            (&mut self.filter_b, &mut self.filter_b_last_updated, &mut self.filter_b_longest_expiry)
        }
    }

    /// Generate hash values for game key bloom filter
    fn hash_game_key(game_key: &Pubkey) -> (usize, usize, usize) {
        // Generate 3 independent hash values for bloom filter
        let hash1 = hash(&game_key.to_bytes());
        let hash2 = hash(&[game_key.to_bytes().as_slice(), b"salt1"].concat());
        let hash3 = hash(&[game_key.to_bytes().as_slice(), b"salt2"].concat());

        // Convert to bit positions (0-511 for 512-bit filter)
        let pos1 = (u64::from_le_bytes(hash1.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;
        let pos2 = (u64::from_le_bytes(hash2.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;
        let pos3 = (u64::from_le_bytes(hash3.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;

        (pos1, pos2, pos3)
    }

    /// Generate hash values for game key + index bloom filter
    fn hash_game_index(game_key: &Pubkey, ticket_index: u32) -> (usize, usize, usize) {
        // Combine game key and ticket index
        let mut combined_data = Vec::with_capacity(36);
        combined_data.extend_from_slice(&game_key.to_bytes());
        combined_data.extend_from_slice(&ticket_index.to_le_bytes());

        // Generate 3 independent hash values for bloom filter
        let hash1 = hash(&combined_data);
        let hash2 = hash(&[combined_data.as_slice(), b"index1"].concat());
        let hash3 = hash(&[combined_data.as_slice(), b"index2"].concat());

        // Convert to bit positions (0-511 for 512-bit filter)
        let pos1 = (u64::from_le_bytes(hash1.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;
        let pos2 = (u64::from_le_bytes(hash2.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;
        let pos3 = (u64::from_le_bytes(hash3.to_bytes()[0..8].try_into().unwrap()) % 512) as usize;

        (pos1, pos2, pos3)
    }

    /// Set bits in bloom filter for a game key (writes to active filter set)
    fn set_bloom_bits(&mut self, game_key: &Pubkey) {
        let (pos1, pos2, pos3) = Self::hash_game_key(game_key);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter (8 x 64-bit words)
        active_filter.game_filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        active_filter.game_filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        active_filter.game_filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    /// Set bits in game index bloom filter for a game key + index (writes to active filter set)
    fn set_game_index_bits(&mut self, game_key: &Pubkey, ticket_index: u32) {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter (8 x 64-bit words)
        active_filter.game_index_filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        active_filter.game_index_filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        active_filter.game_index_filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    /// Set bits in unjoin index bloom filter for a game key + index (writes to active filter set)
    fn set_unjoin_index_bits(&mut self, game_key: &Pubkey, ticket_index: u32) {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);
        let (active_filter, _, _) = self.get_active_filter_mut();

        // Set bits in the 512-bit filter (8 x 64-bit words)
        active_filter.unjoin_index_filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        active_filter.unjoin_index_filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        active_filter.unjoin_index_filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    /// Check if bits are set in bloom filter for a game key (checks both filter sets)
    fn check_bloom_bits(&self, game_key: &Pubkey) -> bool {
        let (pos1, pos2, pos3) = Self::hash_game_key(game_key);

        // Check filter_a
        let a_bit1_set = (self.filter_a.game_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let a_bit2_set = (self.filter_a.game_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let a_bit3_set = (self.filter_a.game_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let a_match = a_bit1_set && a_bit2_set && a_bit3_set;

        // Check filter_b
        let b_bit1_set = (self.filter_b.game_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let b_bit2_set = (self.filter_b.game_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let b_bit3_set = (self.filter_b.game_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let b_match = b_bit1_set && b_bit2_set && b_bit3_set;

        a_match || b_match
    }

    /// Check if bits are set in game index bloom filter for a game key + index (checks both filter sets)
    fn check_game_index_bits(&self, game_key: &Pubkey, ticket_index: u32) -> bool {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);

        // Check filter_a
        let a_bit1_set = (self.filter_a.game_index_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let a_bit2_set = (self.filter_a.game_index_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let a_bit3_set = (self.filter_a.game_index_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let a_match = a_bit1_set && a_bit2_set && a_bit3_set;

        // Check filter_b
        let b_bit1_set = (self.filter_b.game_index_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let b_bit2_set = (self.filter_b.game_index_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let b_bit3_set = (self.filter_b.game_index_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let b_match = b_bit1_set && b_bit2_set && b_bit3_set;

        a_match || b_match
    }

    /// Check if bits are set in unjoin index bloom filter for a game key + index (checks both filter sets)
    fn check_unjoin_index_bits(&self, game_key: &Pubkey, ticket_index: u32) -> bool {
        let (pos1, pos2, pos3) = Self::hash_game_index(game_key, ticket_index);

        // Check filter_a
        let a_bit1_set = (self.filter_a.unjoin_index_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let a_bit2_set = (self.filter_a.unjoin_index_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let a_bit3_set = (self.filter_a.unjoin_index_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let a_match = a_bit1_set && a_bit2_set && a_bit3_set;

        // Check filter_b
        let b_bit1_set = (self.filter_b.unjoin_index_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let b_bit2_set = (self.filter_b.unjoin_index_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let b_bit3_set = (self.filter_b.unjoin_index_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;
        let b_match = b_bit1_set && b_bit2_set && b_bit3_set;

        a_match || b_match
    }

    /// Check if player likely joined this game (bloom filter check)
    fn likely_joined_game(&self, game_key: &Pubkey) -> bool {
        self.check_bloom_bits(game_key)
    }

    /// Main entry point: Check if player can join game (hybrid approach: recent games + dual bloom filter)
    pub fn can_join_game(&self, game_key: &Pubkey, game_created_time: u64) -> bool {
        // First, check the recent games list for high-confidence detection
        if self.is_in_recent_games(game_key) {
            return false; // Definitely already joined
        }

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

    /// Reset filters using dual filter system with safe swapping mechanism
    pub fn maybe_reset_filter(&mut self, current_time: u64) {
        // Get the inactive filter's expiry time
        let (_, _, inactive_longest_expiry) = self.get_inactive_filter();
        
        // Only swap and reset when inactive filter's games have ALL expired
        if current_time > inactive_longest_expiry {
            // Reset the inactive filter set
            let (inactive_filter, inactive_last_updated, inactive_longest_expiry) = self.get_inactive_filter_mut();
            
            *inactive_filter = BloomFilters::default();
            *inactive_last_updated = current_time;
            *inactive_longest_expiry = 0;
            
            // Swap the active filter (the previous inactive becomes active)
            self.active_filter_index = 1 - self.active_filter_index;
            
            // Reset recent games list when swapping
            self.recent_games = [Pubkey::default(); 8];
            self.recent_games_idx = 0;
        }
    }

    /// Mark game as joined in both recent games list and active bloom filter with timestamp tracking
    pub fn mark_game_joined(
        &mut self,
        game_key: &Pubkey,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Maybe reset filter if all old games expired
        self.maybe_reset_filter(current_time);

        // Add to recent games list for high-confidence tracking
        self.add_to_recent_games(game_key);

        // Add to active bloom filter for long-term tracking
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

    /// Checks if player has sufficient balance for withdrawal
    pub fn has_sufficient_balance(&self) -> bool {
        self.amount > 0
    }

    /// Calculates contribution from balance, returns amount needed from wallet
    pub fn calculate_contribution(&mut self, required_amount: u64) -> u64 {
        if self.amount >= required_amount {
            self.amount -= required_amount;
            0
        } else {
            let tokens_needed = required_amount - self.amount;
            self.amount = 0;
            tokens_needed
        }
    }

    /// Handles token transfer from player balance and wallet to game vault
    pub fn handle_token_transfer<'info>(
        &mut self,
        game_amount: u64,
        player_token_account: AccountInfo<'info>,
        game_token_account: AccountInfo<'info>,
        player: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
    ) -> Result<()> {
        let needed_amount = self.calculate_contribution(game_amount);

        if needed_amount > 0 {
            transfer(
                CpiContext::new(
                    token_program,
                    Transfer {
                        from: player_token_account,
                        to: game_token_account,
                        authority: player,
                    },
                ),
                needed_amount,
            )?;
        }

        Ok(())
    }

    /// Mark game + index as joined in both recent games list and active bloom filter
    pub fn mark_game_index_joined(
        &mut self,
        game_key: &Pubkey,
        ticket_index: u32,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Maybe reset filter if all old games expired
        self.maybe_reset_filter(current_time);

        // Add to recent games list for high-confidence tracking
        self.add_to_recent_games(game_key);

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

    /// Check if player can join game with specific index (hybrid approach: recent games + dual bloom filter)
    pub fn can_join_with_index(
        &self,
        game_key: &Pubkey,
        ticket_index: u32,
        game_created_time: u64,
    ) -> bool {
        // First, check the recent games list for high-confidence detection
        if self.is_in_recent_games(game_key) {
            return false; // Definitely already joined this game
        }

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
        // Maybe reset filter if all old games expired
        self.maybe_reset_filter(current_time);

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
    pub timeout: u32,
    /// Last slot when any player action occurred
    pub last_slot: u64,
    /// Whether this is a private game requiring oracle approval
    pub is_private: bool,
    /// Total accumulated prize
    pub total_amount: u64,
}

impl Game {
    // =============================================================================
    // STORAGE CALCULATION & INITIALIZATION
    // =============================================================================

    /// Calculates the total storage size for a game (fixed size with Bloom filter)
    pub fn calculate_storage_size() -> usize {
        GAME_BASE_SIZE
    }

    // =============================================================================
    // CORE GAME LIFECYCLE METHODS
    // =============================================================================

    /// Checks if the game has exceeded its timeout duration
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.created_at + self.timeout as u64
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
        self.created_at + self.timeout as u64 + total_buffer_time
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

        // Hash combination of secret key and last_slot for additional entropy
        let mut combined_data = Vec::with_capacity(40);
        combined_data.extend_from_slice(&secret_key);
        combined_data.extend_from_slice(&self.last_slot.to_le_bytes());
        let entropy_hash = hash(&combined_data).to_bytes();

        // Try sliding 8-byte windows through the hashed entropy
        let max_valid = u64::MAX - (u64::MAX % n_entries);
        for start_pos in 0..=(32 - 8) {
            let random_u64 =
                u64::from_le_bytes(entropy_hash[start_pos..start_pos + 8].try_into().unwrap());

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
            max_tickets >= 1 && min_tickets >= 1
        } else {
            max_tickets >= 2 && min_tickets >= 2
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

    pub fn has_sufficient_balance_for_join(&self, token_balance: u64, player_balance: u64) -> bool {
        self.game_type == GameType::Giveaway
            || self.game_type == GameType::Dumbaway
            || token_balance + player_balance >= self.ticket_amount
    }
}