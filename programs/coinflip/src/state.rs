use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{transfer, Transfer};

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 4 + 4 + 4;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8 + 64 + 8 + 8; // amount + game_filter + filter_last_updated + longest_game_expiry
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
    + 32  // merkle_root
    + 1   // subtree_count
    + 1   // max_subtrees
    + 4   // subtrees length (Vec<T> serialization)
    + 1   // recent_count
    + 4; // recent_tickets length (Vec<T> serialization)

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
// MERKLE TREE STRUCTURES
// =============================================================================

/// Player participation data that gets hashed into merkle tree leaf
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ParticipationEntry {
    /// Player public key
    pub player: Pubkey,
    /// Ticket index in the game (position in merkle tree)
    pub ticket_index: u32,
}

/// Optimized subtree structure (40 bytes)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Subtree {
    /// Hash of the subtree root
    pub root_hash: [u8; 32],
    /// First ticket index in this subtree
    pub start_index: u32,
    /// Size of this subtree (power of 2)
    pub size: u32,
}

/// Recent ticket leaf hash (32 bytes)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct RecentLeaf {
    /// Ticket's leaf hash
    pub hash: [u8; 32],
}

/// Swap-with-last proof for maintaining power-of-2 subtrees during unjoin
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExclusionProof {
    /// Departing player's exclusion proof from their subtree
    pub departing_player_proof: Vec<[u8; 32]>,
    pub departing_subtree_original_root: [u8; 32],

    /// Last player's exclusion proof from smallest subtree
    pub last_player_proof: Vec<[u8; 32]>,
    pub last_subtree_original_root: [u8; 32],

    /// Reconstruction plan for smallest subtree after last player removal
    pub remaining_players_in_smallest: Vec<ParticipationEntry>,
    pub new_power_of_2_root: Option<[u8; 32]>, // None if subtree becomes empty
    pub players_to_recent: Vec<ParticipationEntry>,

    /// New root of departing player's subtree after swap
    pub departing_subtree_new_root: [u8; 32],
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
        new_operator: Pubkey,
    ) {
        self.fee_percentage = fee_percentage;
        self.oracle_buffer_time = oracle_buffer_time;
        self.max_tickets = max_tickets;
        self.max_timeout = max_timeout;
        self.min_timeout = min_timeout;
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
// PLAYER BALANCE ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct PlayerBalance {
    /// Current balance amount
    pub amount: u64,
    /// 512-bit bloom filter for game participation tracking
    pub game_filter: [u64; 8],
    /// Timestamp when filter was last updated
    pub filter_last_updated: u64,
    /// Longest expiration time of games in filter
    pub longest_game_expiry: u64,
}

impl PlayerBalance {
    /// Adds refund amount to player balance
    pub fn refund(&mut self, amount: u64) {
        self.amount += amount;
    }

    /// Generate hash values for bloom filter
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

    /// Set bits in bloom filter for a game key
    fn set_bloom_bits(&mut self, game_key: &Pubkey) {
        let (pos1, pos2, pos3) = Self::hash_game_key(game_key);

        // Set bits in the 512-bit filter (8 x 64-bit words)
        self.game_filter[pos1 / 64] |= 1u64 << (pos1 % 64);
        self.game_filter[pos2 / 64] |= 1u64 << (pos2 % 64);
        self.game_filter[pos3 / 64] |= 1u64 << (pos3 % 64);
    }

    /// Check if bits are set in bloom filter for a game key
    fn check_bloom_bits(&self, game_key: &Pubkey) -> bool {
        let (pos1, pos2, pos3) = Self::hash_game_key(game_key);

        // Check if all bits are set
        let bit1_set = (self.game_filter[pos1 / 64] & (1u64 << (pos1 % 64))) != 0;
        let bit2_set = (self.game_filter[pos2 / 64] & (1u64 << (pos2 % 64))) != 0;
        let bit3_set = (self.game_filter[pos3 / 64] & (1u64 << (pos3 % 64))) != 0;

        bit1_set && bit2_set && bit3_set
    }

    /// Check if player likely joined this game (bloom filter check)
    fn likely_joined_game(&self, game_key: &Pubkey) -> bool {
        self.check_bloom_bits(game_key)
    }

    /// Main entry point: Check if player can join game (considers timestamps + bloom filter)
    pub fn can_join_game(&self, game_key: &Pubkey, game_created_time: u64) -> bool {
        // If game was created AFTER our filter was last updated,
        // it can't possibly be in our filter (even if bits match)
        if game_created_time > self.filter_last_updated {
            return true; // Definitely can join
        }

        // Game is older than our filter, check bloom filter
        !self.likely_joined_game(game_key)
    }

    /// Reset filter if all games have expired
    pub fn maybe_reset_filter(&mut self, current_time: u64) {
        // Only reset when ALL games have expired (current > longest expiry)
        if current_time > self.longest_game_expiry {
            self.game_filter = [0; 8];
            self.filter_last_updated = current_time;
            self.longest_game_expiry = 0; // No games tracked
        }
    }

    /// Mark game as joined in bloom filter with timestamp tracking
    pub fn mark_game_joined(
        &mut self,
        game_key: &Pubkey,
        game_expiry_time: u64,
        current_time: u64,
    ) {
        // Maybe reset filter if all old games expired
        self.maybe_reset_filter(current_time);

        // Add to bloom filter
        self.set_bloom_bits(game_key);

        // Update timestamps
        self.filter_last_updated = current_time;

        // Keep the LONGEST expiration time
        if self.longest_game_expiry == 0 {
            self.longest_game_expiry = game_expiry_time;
        } else {
            self.longest_game_expiry = self.longest_game_expiry.max(game_expiry_time);
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
    /// Merkle root of all player participations
    pub merkle_root: [u8; 32],
    /// Number of active subtrees (dynamic based on max_tickets)
    pub subtree_count: u8,
    /// Maximum allowed subtrees (cached from calculate_required_subtrees)
    pub max_subtrees: u8,
    /// Dynamic subtree storage - size calculated based on max_tickets
    pub subtrees: Vec<Subtree>,
    /// Number of tickets in recent buffer (0-2)
    pub recent_count: u8,
    /// Recent ticket leaves (before subtree aggregation) - optimized to 2 tickets
    pub recent_tickets: Vec<RecentLeaf>,
}

impl Game {
    // =============================================================================
    // STORAGE CALCULATION & INITIALIZATION
    // =============================================================================

    /// Calculates required subtrees using binary decomposition of max_tickets
    pub fn calculate_required_subtrees(max_tickets: u32) -> usize {
        if max_tickets <= 2 {
            return 0; // All tickets fit in recent buffer
        }

        // Calculate how many times we'll fill the 2-ticket buffer
        let buffer_fills = (max_tickets + 1) / 2; // ceil(max_tickets / 2)

        // Use binary decomposition to find minimum subtrees needed
        // Each subtree merge doubles the capacity, so we need count_ones bits
        buffer_fills.count_ones() as usize
    }

    /// Calculates the total dynamic storage size for a game
    pub fn calculate_storage_size(max_tickets: u32) -> usize {
        let required_subtrees = Self::calculate_required_subtrees(max_tickets);
        GAME_BASE_SIZE
            + (required_subtrees * 40)  // Subtree data: 40 bytes per Subtree
            + (2 * 32) // RecentLeaf data: 32 bytes per RecentLeaf, max 2
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
    pub fn calculate_expiry_timestamp(&self, oracle_buffer_time: u16) -> u64 {
        self.created_at + self.timeout as u64 + oracle_buffer_time as u64
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
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> u32 {
        // Use total tickets count for all game types
        let n_entries = self.tickets_count as u64;

        if n_entries == 1 {
            return 0;
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
                return (random_u64 % n_entries) as u32;
            }
        }

        panic!("Unable to generate unbiased random number - game must be cancelled");
    }

    /// Calculates prize distribution with fee deduction
    pub fn calculate_amounts(&self, fee_percentage: u64) -> (u64, u64) {
        let fee_amount = self.total_amount * fee_percentage / 100;
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

    // =============================================================================
    // MERKLE TREE OPERATIONS
    // =============================================================================

    /// Creates a participation entry for a new ticket
    pub fn create_participation_entry(player: Pubkey, ticket_index: u32) -> ParticipationEntry {
        ParticipationEntry {
            player,
            ticket_index,
        }
    }

    /// Calculates hash of a participation entry (merkle tree leaf)
    pub fn hash_participation_entry(entry: &ParticipationEntry) -> [u8; 32] {
        let serialized = entry.try_to_vec().unwrap();
        hash(&serialized).to_bytes()
    }

    /// Verifies a merkle proof for a given leaf against this game's merkle root
    pub fn verify_merkle_proof(&self, leaf: [u8; 32], proof: &[[u8; 32]], leaf_index: u32) -> bool {
        let mut current_hash = leaf;
        let mut current_index = leaf_index;

        for proof_element in proof {
            if current_index % 2 == 0 {
                // Current node is left child
                let combined = [current_hash, *proof_element].concat();
                current_hash = hash(&combined).to_bytes();
            } else {
                // Current node is right child
                let combined = [*proof_element, current_hash].concat();
                current_hash = hash(&combined).to_bytes();
            }
            current_index /= 2;
        }

        current_hash == self.merkle_root
    }

    /// Verifies player participation - checks both subtrees and recent players
    pub fn verify_player_participation(
        &self,
        leaf: [u8; 32],
        proof: &[[u8; 32]],
        ticket_index: u32,
    ) -> bool {
        // Calculate how many tickets are in committed subtrees
        let committed_tickets = self.tickets_count - self.recent_count as u32;

        if ticket_index >= committed_tickets {
            // Ticket is in recent_tickets buffer - verify directly
            self.verify_recent_ticket(leaf, ticket_index - committed_tickets)
        } else {
            // Ticket is in committed subtrees - use standard merkle proof
            self.verify_merkle_proof(leaf, proof, ticket_index)
        }
    }

    /// Verifies a recent ticket by direct comparison
    fn verify_recent_ticket(&self, leaf: [u8; 32], recent_index: u32) -> bool {
        if recent_index >= self.recent_count as u32 {
            return false; // Index out of bounds
        }

        // Direct comparison with stored recent player hash
        self.recent_tickets[recent_index as usize].hash == leaf
    }

    /// Adds a ticket to the merkle tree using buffer-based aggregation
    pub fn add_ticket_to_merkle_tree(&mut self, player: Pubkey) -> Result<()> {
        let participation = Game::create_participation_entry(player, self.tickets_count);
        let leaf_hash = Game::hash_participation_entry(&participation);

        if self.recent_count < 2 {
            // Just add to buffer - no structure change
            self.recent_tickets.push(RecentLeaf { hash: leaf_hash });
            self.recent_count += 1;
            // NO root update needed!
        } else {
            // Structure changes - update root
            let new_subtree = self.build_subtree_from_recent()?;
            self.merge_subtree(new_subtree)?;
            self.recent_tickets.clear();
            self.recent_tickets.push(RecentLeaf { hash: leaf_hash });
            self.recent_count = 1;
            self.update_merkle_root()?; // Only update when structure changes
        }

        self.tickets_count += 1;
        self.total_amount += self.ticket_amount;
        Ok(())
    }

    // =============================================================================
    // COMMON VALIDATION HELPERS
    // =============================================================================

    /// Finds largest power-of-2 ≤ n for player splitting during exclusion
    fn largest_power_of_2_le(n: usize) -> usize {
        if n > 0 {
            1 << (31 - (n as u32).leading_zeros() - 1)
        } else {
            0
        }
    }

    /// Validates merkle proof, returns InvalidExclusionProof on failure
    fn require_valid_merkle_proof(
        leaf: [u8; 32],
        proof: &[[u8; 32]],
        leaf_index: u32,
        target_root: [u8; 32],
    ) -> Result<()> {
        require!(
            Self::verify_merkle_proof_against_root(leaf, proof, leaf_index, target_root),
            ErrorCode::InvalidExclusionProof
        );
        Ok(())
    }

    // =============================================================================
    // MERKLE TREE INTERNAL HELPERS (PRIVATE)
    // =============================================================================

    /// Builds 2-player subtree from recent buffer
    fn build_subtree_from_recent(&self) -> Result<Subtree> {
        require!(self.recent_count == 2, ErrorCode::InvalidAmount);

        // Start index for recent buffer tickets
        let start_index = self.tickets_count - self.recent_count as u32;
        let leaves: Vec<[u8; 32]> = self.recent_tickets.iter().map(|leaf| leaf.hash).collect();

        Ok(Subtree {
            root_hash: Self::compute_merkle_root(&leaves),
            start_index,
            size: 2,
        })
    }

    /// Merges new subtree into storage, combining same-sized subtrees if needed
    fn merge_subtree(&mut self, new: Subtree) -> Result<()> {
        // If we have space, just add the new subtree
        if self.subtrees.len() < self.max_subtrees as usize {
            self.add_subtree_directly(new);
            return Ok(());
        }

        // Storage is full - need to merge existing subtrees to make space
        self.merge_existing_subtrees_for_space()?;

        // Now we have space for the new subtree
        self.add_subtree_directly(new);

        Ok(())
    }

    /// Adds a subtree directly to storage when space is available
    fn add_subtree_directly(&mut self, subtree: Subtree) {
        self.subtrees.push(subtree);
        self.subtree_count += 1;
    }

    /// Merges two existing same-sized subtrees to make space for a new subtree
    fn merge_existing_subtrees_for_space(&mut self) -> Result<()> {
        // Find two same-sized subtrees to merge
        let (idx1, idx2) = self
            .find_same_sized_pair()
            .ok_or(ErrorCode::MerkleTreeStructureError)?;

        let subtree1 = self.subtrees[idx1];
        let subtree2 = self.subtrees[idx2];

        // Remove both subtrees and create merged version
        self.remove_subtree_pair(idx1, idx2);
        let merged_subtree = self.create_merged_subtree(subtree1, subtree2);

        // Add the merged subtree back
        self.add_subtree_directly(merged_subtree);

        Ok(())
    }

    /// Removes subtree pair (higher index first to avoid shifting)
    fn remove_subtree_pair(&mut self, idx1: usize, idx2: usize) {
        let (first_idx, second_idx) = if idx1 > idx2 {
            (idx1, idx2)
        } else {
            (idx2, idx1)
        };

        // Remove higher index first
        self.subtrees.remove(first_idx);

        // Adjust second index after first removal
        let adjusted_second_idx = if second_idx > first_idx {
            second_idx - 1
        } else {
            second_idx
        };
        self.subtrees.remove(adjusted_second_idx);

        self.subtree_count -= 2;
    }

    fn create_merged_subtree(&self, subtree1: Subtree, subtree2: Subtree) -> Subtree {
        // Order hashes by start index for consistent structure
        let (left, right) = if subtree1.start_index < subtree2.start_index {
            (subtree1.root_hash, subtree2.root_hash)
        } else {
            (subtree2.root_hash, subtree1.root_hash)
        };

        Subtree {
            root_hash: hash(&[left, right].concat()).to_bytes(),
            start_index: subtree1.start_index.min(subtree2.start_index),
            size: subtree1.size + subtree2.size,
        }
    }

    /// Finds smallest pair of same-sized subtrees for optimal merging
    fn find_same_sized_pair(&self) -> Option<(usize, usize)> {
        let mut best_pair: Option<(usize, usize)> = None;
        let mut smallest_size = u32::MAX;

        for i in 0..self.subtrees.len() {
            for j in (i + 1)..self.subtrees.len() {
                if self.subtrees[i].size == self.subtrees[j].size
                    && self.subtrees[i].size < smallest_size
                {
                    smallest_size = self.subtrees[i].size;
                    best_pair = Some((i, j));
                }
            }
        }
        best_pair
    }

    fn find_smallest_subtree(&self) -> usize {
        let mut smallest_idx = 0;
        let mut smallest_size = u32::MAX;

        for i in 0..self.subtrees.len() {
            if self.subtrees[i].size < smallest_size {
                smallest_size = self.subtrees[i].size;
                smallest_idx = i;
            }
        }

        smallest_idx
    }

    /// Updates global merkle root from subtrees only (excludes recent players)
    fn update_merkle_root(&mut self) -> Result<()> {
        let mut hashes = Vec::new();

        // Add all subtree roots (sorted by start_index)
        let mut subtrees: Vec<&Subtree> = self.subtrees.iter().collect();
        subtrees.sort_by_key(|s| s.start_index);
        hashes.extend(subtrees.iter().map(|s| s.root_hash));

        // Recent players excluded - verified separately

        self.merkle_root = if hashes.is_empty() {
            [0; 32] // Empty tree when no subtrees exist
        } else {
            Self::compute_merkle_root(&hashes)
        };

        Ok(())
    }

    /// Computes merkle root using bottom-up binary tree construction
    fn compute_merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
        if leaves.is_empty() {
            return [0; 32];
        }

        let mut layer = leaves.to_vec();
        while layer.len() > 1 {
            layer = layer
                .chunks(2)
                .map(|chunk| {
                    if chunk.len() == 2 {
                        hash(&[chunk[0], chunk[1]].concat()).to_bytes()
                    } else {
                        chunk[0]
                    }
                })
                .collect();
        }
        layer[0]
    }

    /// Initialize merkle system for new game with dynamic allocation based on max_tickets
    pub fn initialize_merkle_system(&mut self, max_tickets: u32) -> Result<()> {
        // Calculate required subtrees and cache the value
        let required_subtrees = Self::calculate_required_subtrees(max_tickets);

        // Initialize dynamic vectors and cached values
        self.subtree_count = 0;
        self.max_subtrees = required_subtrees as u8;
        self.subtrees = Vec::new();
        self.recent_count = 0;
        self.recent_tickets = Vec::new();
        self.merkle_root = [0; 32];

        Ok(())
    }

    // =============================================================================
    // EXCLUSION PROOF VERIFICATION FUNCTIONS
    // =============================================================================

    /// Finds which subtree contains ticket index (None if in recent buffer)
    pub fn find_subtree_containing_ticket(&self, ticket_index: u32) -> Option<usize> {
        for (i, subtree) in self.subtrees.iter().enumerate() {
            let end_index = subtree.start_index + subtree.size - 1;
            if ticket_index >= subtree.start_index && ticket_index <= end_index {
                return Some(i);
            }
        }
        None // Ticket is in recent_tickets
    }

    /// Verify a merkle proof against a specific root hash
    pub fn verify_merkle_proof_against_root(
        leaf: [u8; 32],
        proof: &[[u8; 32]],
        leaf_index: u32,
        target_root: [u8; 32],
    ) -> bool {
        let mut current_hash = leaf;
        let mut current_index = leaf_index;

        for proof_element in proof {
            if current_index % 2 == 0 {
                // Current node is left child
                let combined = [current_hash, *proof_element].concat();
                current_hash = hash(&combined).to_bytes();
            } else {
                // Current node is right child
                let combined = [*proof_element, current_hash].concat();
                current_hash = hash(&combined).to_bytes();
            }
            current_index /= 2;
        }

        current_hash == target_root
    }

    /// Verifies exclusion proof for removing a player via swap-with-last
    pub fn verify_exclusion_proof(
        &self,
        proof: &ExclusionProof,
        departing_player_key: Pubkey,
        departing_ticket_index: u32,
    ) -> Result<bool> {
        // Find subtrees involved in the swap operation
        let (departing_subtree_idx, smallest_subtree_idx) =
            self.find_exclusion_subtrees(departing_ticket_index)?;

        // Verify the departing player is actually in their claimed subtree
        self.verify_departing_player_in_subtree(
            proof,
            departing_player_key,
            departing_ticket_index,
            departing_subtree_idx,
        )?;

        // Verify the smallest subtree state matches the proof
        self.verify_smallest_subtree_state(proof, smallest_subtree_idx)?;

        // Verify the reconstruction plan maintains merkle tree integrity
        self.verify_reconstruction_plan(proof)?;

        Ok(true)
    }

    /// Finds the subtrees involved in exclusion: departing player's subtree and smallest subtree
    fn find_exclusion_subtrees(&self, departing_ticket_index: u32) -> Result<(usize, usize)> {
        let departing_subtree_idx = self
            .find_subtree_containing_ticket(departing_ticket_index)
            .ok_or(ErrorCode::SubtreeNotFound)?;

        let smallest_subtree_idx = self.find_smallest_subtree();

        Ok((departing_subtree_idx, smallest_subtree_idx))
    }

    /// Verifies that the departing player exists in their claimed subtree
    fn verify_departing_player_in_subtree(
        &self,
        proof: &ExclusionProof,
        departing_player_key: Pubkey,
        departing_ticket_index: u32,
        departing_subtree_idx: usize,
    ) -> Result<()> {
        let departing_subtree = &self.subtrees[departing_subtree_idx];

        // Verify the proof claims the correct subtree root
        require!(
            proof.departing_subtree_original_root == departing_subtree.root_hash,
            ErrorCode::InvalidExclusionProof
        );

        // Create and hash the participation entry
        let departing_player_entry =
            Game::create_participation_entry(departing_player_key, departing_ticket_index);
        let departing_leaf = Game::hash_participation_entry(&departing_player_entry);
        let departing_relative_index = departing_ticket_index - departing_subtree.start_index;

        // Verify merkle proof that player exists in the subtree
        Self::require_valid_merkle_proof(
            departing_leaf,
            &proof.departing_player_proof,
            departing_relative_index,
            proof.departing_subtree_original_root,
        )?;

        Ok(())
    }

    /// Verifies the smallest subtree state matches what the proof claims
    fn verify_smallest_subtree_state(
        &self,
        proof: &ExclusionProof,
        smallest_subtree_idx: usize,
    ) -> Result<()> {
        let smallest_subtree = &self.subtrees[smallest_subtree_idx];

        // Verify the proof claims the correct smallest subtree root
        require!(
            proof.last_subtree_original_root == smallest_subtree.root_hash,
            ErrorCode::InvalidExclusionProof
        );

        // Verify the remaining players count is correct (subtree size - 1)
        let remaining_count = proof.remaining_players_in_smallest.len();
        require!(
            remaining_count == (smallest_subtree.size - 1) as usize,
            ErrorCode::MalformedSubtreeProof
        );

        Ok(())
    }

    /// Verifies the reconstruction plan maintains power-of-2 subtree requirements
    fn verify_reconstruction_plan(&self, proof: &ExclusionProof) -> Result<()> {
        let remaining_count = proof.remaining_players_in_smallest.len();

        if remaining_count == 0 {
            // Case 1: Subtree becomes empty after removing last player
            self.verify_empty_subtree_plan(proof)?;
        } else if remaining_count.is_power_of_two() {
            // Case 2: Perfect power-of-2, all players stay in subtree
            self.verify_perfect_power_of_2_plan(proof)?;
        } else {
            // Case 3: Split players between subtree and recent buffer
            self.verify_split_reconstruction_plan(proof, remaining_count)?;
        }

        Ok(())
    }

    /// Verifies reconstruction plan when subtree becomes empty
    fn verify_empty_subtree_plan(&self, proof: &ExclusionProof) -> Result<()> {
        require!(
            proof.new_power_of_2_root.is_none(),
            ErrorCode::InvalidExclusionProof
        );
        require!(
            proof.players_to_recent.is_empty(),
            ErrorCode::InvalidExclusionProof
        );
        Ok(())
    }

    /// Verifies reconstruction plan when remaining count is a perfect power-of-2
    fn verify_perfect_power_of_2_plan(&self, proof: &ExclusionProof) -> Result<()> {
        require!(
            proof.new_power_of_2_root.is_some(),
            ErrorCode::InvalidExclusionProof
        );
        require!(
            proof.players_to_recent.is_empty(),
            ErrorCode::InvalidExclusionProof
        );
        Ok(())
    }

    /// Verifies reconstruction plan when players must be split between subtree and recent buffer
    fn verify_split_reconstruction_plan(
        &self,
        proof: &ExclusionProof,
        remaining_count: usize,
    ) -> Result<()> {
        // Calculate power-of-2 split threshold
        let largest_power_of_2_le = Self::largest_power_of_2_le(remaining_count);

        let subtree_players = largest_power_of_2_le;
        let recent_tickets = remaining_count - subtree_players;

        // Verify the correct number of players are moved to recent buffer
        require!(
            proof.players_to_recent.len() == recent_tickets,
            ErrorCode::MalformedSubtreeProof
        );

        // Verify new root existence based on whether subtree will have players
        if subtree_players > 0 {
            require!(
                proof.new_power_of_2_root.is_some(),
                ErrorCode::InvalidExclusionProof
            );
        } else {
            require!(
                proof.new_power_of_2_root.is_none(),
                ErrorCode::InvalidExclusionProof
            );
        }

        Ok(())
    }

    /// Executes verified exclusion by updating subtrees and global root
    pub fn modify_subtree_after_verified_exclusion(
        &mut self,
        proof: &ExclusionProof,
        departing_ticket_index: u32,
    ) -> Result<()> {
        let (departing_subtree_idx, smallest_subtree_idx) =
            self.find_exclusion_subtrees(departing_ticket_index)?;

        // Update departing player's subtree with swapped-in last player
        self.update_departing_subtree(proof, departing_subtree_idx);

        // Handle smallest subtree reconstruction based on remaining players
        self.reconstruct_smallest_subtree(proof, smallest_subtree_idx)?;

        // Update global merkle root to reflect all changes
        self.update_merkle_root()?;

        Ok(())
    }

    /// Updates the departing player's subtree with the new root after swap
    fn update_departing_subtree(&mut self, proof: &ExclusionProof, departing_subtree_idx: usize) {
        // Replace departing player with last player (swap operation)
        self.subtrees[departing_subtree_idx].root_hash = proof.departing_subtree_new_root;
        // Size unchanged (swap, not removal)
    }

    fn reconstruct_smallest_subtree(
        &mut self,
        proof: &ExclusionProof,
        smallest_subtree_idx: usize,
    ) -> Result<()> {
        let remaining_count = proof.remaining_players_in_smallest.len();

        if remaining_count == 0 {
            // Case 1: Subtree becomes empty - remove it entirely
            self.remove_empty_subtree(smallest_subtree_idx);
        } else if remaining_count.is_power_of_two() {
            // Case 2: Perfect power-of-2 - update subtree in place
            self.update_perfect_power_of_2_subtree(proof, smallest_subtree_idx, remaining_count);
        } else {
            // Case 3: Split between subtree and recent buffer
            self.split_subtree_reconstruction(proof, smallest_subtree_idx, remaining_count)?;
        }

        Ok(())
    }

    fn remove_empty_subtree(&mut self, subtree_idx: usize) {
        self.subtrees.remove(subtree_idx);
        self.subtree_count -= 1;
    }

    fn update_perfect_power_of_2_subtree(
        &mut self,
        proof: &ExclusionProof,
        subtree_idx: usize,
        remaining_count: usize,
    ) {
        self.subtrees[subtree_idx].root_hash = proof.new_power_of_2_root.unwrap();
        self.subtrees[subtree_idx].size = remaining_count as u32;
    }

    /// Handles split reconstruction: some players to subtree, some to recent buffer
    fn split_subtree_reconstruction(
        &mut self,
        proof: &ExclusionProof,
        smallest_subtree_idx: usize,
        remaining_count: usize,
    ) -> Result<()> {
        // Split calculation: subtree vs recent buffer
        let largest_power_of_2_le = Self::largest_power_of_2_le(remaining_count);
        let subtree_players = largest_power_of_2_le;

        if subtree_players > 0 {
            // Update subtree with power-of-2 portion
            self.subtrees[smallest_subtree_idx].root_hash = proof.new_power_of_2_root.unwrap();
            self.subtrees[smallest_subtree_idx].size = subtree_players as u32;
        } else {
            // Remove subtree entirely if no players remain
            self.remove_empty_subtree(smallest_subtree_idx);
        }

        // Move excess players to recent_tickets buffer
        self.move_players_to_recent_buffer(proof)?;

        Ok(())
    }

    /// Moves excess players from subtree to recent_tickets buffer
    fn move_players_to_recent_buffer(&mut self, proof: &ExclusionProof) -> Result<()> {
        for player_entry in &proof.players_to_recent {
            let leaf_hash = Game::hash_participation_entry(player_entry);
            self.recent_tickets.push(RecentLeaf { hash: leaf_hash });
            self.recent_count += 1;
        }
        Ok(())
    }
}
