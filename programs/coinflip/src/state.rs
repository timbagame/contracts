use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{transfer, Transfer};

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 4 + 4 + 4;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8;
// PlayerParticipation eliminated - using merkle trees!
pub const GAME_SIZE: usize = 8
    + 32  // creator
    + 1   // game_type
    + 8   // ticket_amount
    + 4   // max_players
    + 4   // min_players
    + 4   // players_count
    + 32  // token_mint
    + 8   // created_at
    + 4   // timeout
    + 8   // last_slot
    + 1   // is_private
    + 8   // total_amount
    + 32  // merkle_root
    + 1   // subtree_count
    + 640 // subtrees: 16 × 40 bytes (fixed size)
    + 1   // recent_count
    + 512; // recent_players: 16 × 32 bytes (fixed size) = 1,367 bytes total

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
    /// Player's index in the game (position in merkle tree)
    pub player_index: u32,
    /// Timestamp when player joined
    pub join_timestamp: u64,
}

/// Merkle proof for verifying leaf inclusion
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MerkleProof {
    /// The leaf being proven
    pub leaf: [u8; 32],
    /// Merkle path from leaf to root
    pub proof: Vec<[u8; 32]>,
    /// Index of the leaf in the tree
    pub leaf_index: u32,
}

/// Optimized subtree structure (40 bytes)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Subtree {
    /// Hash of the subtree root
    pub root_hash: [u8; 32],
    /// First player index in this subtree
    pub start_index: u32,
    /// Size of this subtree (power of 2)
    pub size: u32,
}

/// Recent player leaf hash (32 bytes)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct RecentLeaf {
    /// Player's leaf hash
    pub hash: [u8; 32],
}

// =============================================================================
// ORACLE ACCOUNT
// =============================================================================
#[account]
#[derive(Default)]
pub struct Oracle {
    /// Authority that can update oracle settings and claim fees
    pub authority: Pubkey,
    /// Percentage of game amount taken as fee (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout before cancellation is allowed
    pub oracle_buffer_time: u16,
    /// Maximum number of players allowed in a game
    pub max_players: u32,
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

    /// Checks if given authority matches oracle authority
    pub fn is_authorized_authority(&self, authority: &Pubkey) -> bool {
        self.authority == *authority
    }

    /// Validates timeout is within oracle's allowed range
    pub fn is_valid_timeout_range(&self, timeout: u32) -> bool {
        timeout >= self.min_timeout && timeout <= self.max_timeout
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
}

impl PlayerBalance {
    /// Adds refund amount to player balance
    pub fn refund(&mut self, amount: u64) {
        self.amount += amount;
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
// NO MORE PLAYER PARTICIPATION ACCOUNTS!
// All participation data is now stored in merkle tree + events
// =============================================================================

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
    /// Maximum number of players allowed
    pub max_players: u32,
    /// Minimum number of players required
    pub min_players: u32,
    /// Current number of players who have joined
    pub players_count: u32,
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
    /// Number of active subtrees (0-16)
    pub subtree_count: u8,
    /// Fixed-size array for subtree storage
    pub subtrees: [Subtree; 16],
    /// Number of players in recent buffer (0-16)
    pub recent_count: u8,
    /// Recent player leaves (before subtree aggregation)
    pub recent_players: [RecentLeaf; 16],
}

impl Game {
    /// Checks if the game has exceeded its timeout duration
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.created_at + self.timeout as u64
    }

    /// Checks if the game meets requirements to be completed by oracle
    pub fn is_ready_for_completion(&self, current_time: u64) -> bool {
        let has_min_players = self.players_count >= self.min_players;
        let has_max_players = self.players_count == self.max_players;
        let timeout_reached = self.is_expired(current_time);

        // Game is ready if it has max players OR (min players AND timeout reached)
        has_max_players || (has_min_players && timeout_reached)
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
        // For Snowball and Dumbball games, use total entries (total_amount / ticket_amount)
        // For other games, use unique players count
        let n_entries =
            if self.game_type == GameType::Snowball || self.game_type == GameType::Dumbball {
                self.total_amount / self.ticket_amount
            } else {
                self.players_count as u64
            };

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
        if game_type == GameType::Giveaway || game_type == GameType::Dumbaway {
            max_players >= 1 && min_players >= 1
        } else {
            max_players >= 2 && min_players >= 2
        }
    }

    pub fn can_join_private(&self, authority: Option<&Signer>, oracle_authority: &Pubkey) -> bool {
        !self.is_private || authority.map_or(false, |signer| signer.key() == *oracle_authority)
    }

    pub fn has_sufficient_balance_for_join(&self, token_balance: u64, player_balance: u64) -> bool {
        self.game_type == GameType::Giveaway
            || self.game_type == GameType::Dumbaway
            || token_balance + player_balance >= self.ticket_amount
    }

    // =============================================================================
    // MERKLE TREE FUNCTIONS
    // =============================================================================

    /// Creates a participation entry for a new player
    pub fn create_participation_entry(
        player: Pubkey,
        player_index: u32,
        timestamp: u64,
    ) -> ParticipationEntry {
        ParticipationEntry {
            player,
            player_index,
            join_timestamp: timestamp,
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

    /// Adds a player to the merkle tree using buffer-based aggregation
    pub fn add_player_to_merkle_tree(&mut self, player: Pubkey, timestamp: u64) -> Result<()> {
        // Create participation entry internally
        let participation = Self::create_participation_entry(player, self.players_count, timestamp);
        let leaf_hash = Self::hash_participation_entry(&participation);

        // Add to recent buffer or trigger subtree creation
        if self.recent_count < 16 {
            // Add to buffer (O(1) operation)
            self.recent_players[self.recent_count as usize] = RecentLeaf { hash: leaf_hash };
            self.recent_count += 1;
        } else {
            // Buffer is full - create subtree and merge
            let new_subtree = self.build_subtree_from_recent()?;
            self.merge_subtree(new_subtree)?;
            
            // Reset buffer with new player
            self.recent_players[0] = RecentLeaf { hash: leaf_hash };
            self.recent_count = 1;
        }

        // Update game state
        self.players_count += 1;
        self.total_amount += self.ticket_amount;

        // Update global merkle root
        self.update_merkle_root()?;

        Ok(())
    }

    /// Builds 16-player subtree from recent buffer
    fn build_subtree_from_recent(&self) -> Result<Subtree> {
        require!(self.recent_count == 16, crate::error::ErrorCode::InvalidAmount);
        
        let start_index = self.players_count.saturating_sub(15);
        let leaves: Vec<[u8; 32]> = self.recent_players[..16]
            .iter()
            .map(|leaf| leaf.hash)
            .collect();
        
        Ok(Subtree {
            root_hash: Self::compute_merkle_root(&leaves),
            start_index,
            size: 16,
        })
    }

    /// Merges new subtree with existing ones using size-based merging
    fn merge_subtree(&mut self, mut new: Subtree) -> Result<()> {
        // Continuously merge same-sized subtrees
        while let Some(existing_idx) = self.find_subtree_by_size(new.size) {
            let existing = self.subtrees[existing_idx];
            
            // Remove existing subtree by moving last element to this position
            self.subtrees[existing_idx] = self.subtrees[self.subtree_count as usize - 1];
            self.subtree_count -= 1;

            // Create merged subtree (double size)
            let (left, right) = if existing.start_index < new.start_index {
                (existing.root_hash, new.root_hash)
            } else {
                (new.root_hash, existing.root_hash)
            };
            
            new = Subtree {
                root_hash: hash(&[left, right].concat()).to_bytes(),
                start_index: existing.start_index.min(new.start_index),
                size: new.size * 2,
            };
        }

        // Add final merged subtree
        require!(self.subtree_count < 16, crate::error::ErrorCode::InvalidAmount);
        self.subtrees[self.subtree_count as usize] = new;
        self.subtree_count += 1;
        
        Ok(())
    }
    
    /// Aggregates stable subtrees when recent players can form new power-of-2 subtrees
    fn aggregate_stable_subtrees(&mut self, total_players: u32) -> Result<()> {
        let stable_players_count = self.stable_subtrees.iter()
            .map(|subtree| subtree.subtree_size)
            .sum::<u32>();
        
        let recent_players_count = total_players - stable_players_count;
        
        // Check if recent players can form a new power-of-2 subtree
        if recent_players_count > 0 && (recent_players_count & (recent_players_count - 1)) == 0 {
            // Recent players form a perfect power of 2 - create new stable subtree
            let new_subtree_size = recent_players_count;
            let new_subtree_start = stable_players_count;
            
            // Calculate hash from all current recent players
            let root_hash = if new_subtree_size == 1 {
                self.recent_players[0].leaf_hash
            } else {
                self.calculate_recent_players_tree_hash()?
            };
            
            // Add new stable subtree
            self.stable_subtrees.push(StableSubtree {
                root_hash,
                first_player_index: new_subtree_start,
                subtree_size: new_subtree_size,
            });
            
            // Clear recent players since they're now stable
            self.recent_players.clear();
            
            // After creating new subtree, check if we can merge with existing ones
            self.merge_adjacent_subtrees()?;
        }
        
        Ok(())
    }
    
    /// Merge adjacent subtrees of the same size to maintain optimal binary decomposition
    fn merge_adjacent_subtrees(&mut self) -> Result<()> {
        let mut merged = true;
        
        while merged {
            merged = false;
            
            // Sort subtrees by first_player_index to find adjacent ones
            self.stable_subtrees.sort_by_key(|s| s.first_player_index);
            
            let mut i = 0;
            while i < self.stable_subtrees.len() - 1 {
                let current = &self.stable_subtrees[i];
                let next = &self.stable_subtrees[i + 1];
                
                // Check if these subtrees can be merged (same size and adjacent)
                if current.subtree_size == next.subtree_size && 
                   current.first_player_index + current.subtree_size == next.first_player_index {
                    
                    // Merge the two subtrees
                    let merged_size = current.subtree_size * 2;
                    let merged_start = current.first_player_index;
                    
                    // Calculate merged hash
                    let combined = [current.root_hash, next.root_hash].concat();
                    let merged_hash = hash(&combined).to_bytes();
                    
                    // Replace with merged subtree
                    let merged_subtree = StableSubtree {
                        root_hash: merged_hash,
                        first_player_index: merged_start,
                        subtree_size: merged_size,
                    };
                    
                    // Remove the two old subtrees and add merged one
                    self.stable_subtrees.remove(i + 1);
                    self.stable_subtrees.remove(i);
                    self.stable_subtrees.insert(i, merged_subtree);
                    
                    merged = true;
                    break; // Restart the merge process
                }
                i += 1;
            }
        }
        
        Ok(())
    }
    
    /// Calculate tree hash from all current recent players
    fn calculate_recent_players_tree_hash(&self) -> Result<[u8; 32]> {
        let mut level_hashes: Vec<[u8; 32]> = self.recent_players
            .iter()
            .map(|p| p.leaf_hash)
            .collect();
        
        // Build tree bottom-up
        while level_hashes.len() > 1 {
            let mut next_level = Vec::new();
            
            for i in (0..level_hashes.len()).step_by(2) {
                let left = level_hashes[i];
                let right = if i + 1 < level_hashes.len() {
                    level_hashes[i + 1]
                } else {
                    [0; 32] // Pad with zero for incomplete trees
                };
                
                let combined = [left, right].concat();
                next_level.push(hash(&combined).to_bytes());
            }
            
            level_hashes = next_level;
        }
        
        Ok(level_hashes[0])
    }

    /// Calculates merkle proof for a given player index using zero-proof approach
    fn calculate_merkle_proof(&self, player_index: u32) -> Result<Vec<[u8; 32]>> {
        let mut proof = Vec::new();
        let mut current_index = player_index;
        let mut level = 0;

        // Build proof by finding siblings at each level
        while current_index > 0 || level == 0 {
            let sibling_index = current_index ^ 1;

            // Get sibling hash
            let sibling_hash = if level == 0 {
                // Leaf level - check recent players or stable subtrees
                self.get_leaf_hash(sibling_index)?
            } else {
                // Higher levels - calculate from stable subtrees or recent data
                self.calculate_internal_node_hash(level, sibling_index)?
            };

            proof.push(sibling_hash);
            current_index /= 2;
            level += 1;

            // Stop when we reach tree root level
            if current_index == 0 && level > 1 {
                break;
            }
        }

        Ok(proof)
    }

    /// Initialize merkle system for new game
    pub fn initialize_merkle_system(&mut self) -> Result<()> {
        // Initialize fixed-size arrays with default values
        self.subtree_count = 0;
        self.subtrees = [Subtree::default(); 16];
        self.recent_count = 0;
        self.recent_players = [RecentLeaf::default(); 16];
        self.merkle_root = [0; 32];

        Ok(())
    }

    // Helper functions

    /// Get leaf hash for a specific player index
    fn get_leaf_hash(&self, player_index: u32) -> Result<[u8; 32]> {
        // Player beyond current count - return zero hash
        if player_index >= self.players_count {
            return Ok([0; 32]);
        }
        
        // Check if player is in a stable subtree
        for subtree in &self.stable_subtrees {
            if player_index >= subtree.first_player_index && 
               player_index < subtree.first_player_index + subtree.subtree_size {
                // Player is in a stable subtree - we can't get individual leaf hashes
                // This should only happen during proof calculation, not direct access
                return Err(crate::error::ErrorCode::InvalidAmount.into());
            }
        }
        
        // Player must be in recent players (beyond stable subtrees)
        let stable_players_count = self.stable_subtrees.iter()
            .map(|subtree| subtree.subtree_size)
            .sum::<u32>();
        
        if player_index >= stable_players_count {
            let recent_offset = (player_index - stable_players_count) as usize;
            if let Some(recent_player) = self.recent_players.get(recent_offset) {
                return Ok(recent_player.leaf_hash);
            }
        }
        
        // Should never reach here with valid indices
        Err(crate::error::ErrorCode::InvalidAmount.into())
    }

    /// Calculate hash for a subtree covering recent players only
    fn calculate_subtree_range_hash(&self, start_index: u32, subtree_size: u32) -> Result<[u8; 32]> {
        // This should only be called for ranges that are within recent players
        let stable_players_count = self.stable_subtrees.iter()
            .map(|subtree| subtree.subtree_size)
            .sum::<u32>();

        require!(
            start_index >= stable_players_count,
            crate::error::ErrorCode::InvalidAmount
        );

        if subtree_size == 1 {
            // Single leaf from recent players
            let recent_offset = (start_index - stable_players_count) as usize;
            if let Some(recent_player) = self.recent_players.get(recent_offset) {
                return Ok(recent_player.leaf_hash);
            }
            return Err(crate::error::ErrorCode::InvalidAmount.into());
        }

        // Build subtree from recent players only
        let mut level_hashes = Vec::new();

        for i in 0..subtree_size {
            let player_index = start_index + i;
            let recent_offset = (player_index - stable_players_count) as usize;
            
            if let Some(recent_player) = self.recent_players.get(recent_offset) {
                level_hashes.push(recent_player.leaf_hash);
            } else {
                return Err(crate::error::ErrorCode::InvalidAmount.into());
            }
        }

        // Build tree bottom-up
        while level_hashes.len() > 1 {
            let mut next_level = Vec::new();

            for i in (0..level_hashes.len()).step_by(2) {
                let left = level_hashes[i];
                let right = if i + 1 < level_hashes.len() {
                    level_hashes[i + 1]
                } else {
                    [0; 32] // Pad with zero for incomplete trees
                };

                let combined = [left, right].concat();
                next_level.push(hash(&combined).to_bytes());
            }

            level_hashes = next_level;
        }

        Ok(level_hashes[0])
    }


    /// Calculate hash for internal node at given level and index
    fn calculate_internal_node_hash(&self, level: u8, node_index: u32) -> Result<[u8; 32]> {
        // Base case: leaf level
        if level == 0 {
            return self.get_leaf_hash(node_index);
        }

        // Check if this node is exactly a stable subtree root
        for subtree in &self.stable_subtrees {
            let subtree_depth = (subtree.subtree_size as f32).log2() as u8;
            let subtree_root_index = subtree.first_player_index >> level;

            if level == subtree_depth && node_index == subtree_root_index {
                // This node is exactly the root of this stable subtree
                return Ok(subtree.root_hash);
            }
        }

        // Not a stable subtree root - calculate from children
        let left_child = node_index * 2;
        let right_child = left_child + 1;

        let left_hash = self.calculate_internal_node_hash(level - 1, left_child)?;
        let right_hash = self.calculate_internal_node_hash(level - 1, right_child)?;

        // Handle empty right child (for incomplete trees)
        let combined = [left_hash, right_hash].concat();
        Ok(hash(&combined).to_bytes())
    }
}
