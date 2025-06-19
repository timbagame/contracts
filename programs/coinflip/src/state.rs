use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 4 + 4 + 4;
pub const GAME_TOKEN_SIZE: usize = 8 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 8;
// PlayerParticipation eliminated - using merkle trees!
pub const GAME_SIZE: usize = 8 + 32 + 1 + 8 + 4 + 4 + 4 + 32 + 8 + 4 + 8 + 1 + 8 + 32; // +32 for merkle_root

// =============================================================================
// GAME TYPES
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    /// Two or more players compete for the pot
    Coinflip,
    /// One or more players compete for a giveaway from the creator
    Giveaway,
    /// Two or more players compete for the pot, reveal winner in real-time
    Dumbflip,
    /// Snowball: multi-join, no unjoin, accumulating pot, real-time winner reveal
    Snowball,
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
    /// Amount contributed by player
    pub amount: u64,
    /// Player's index in the game (position in merkle tree)
    pub player_index: u32,
    /// Timestamp when player joined
    pub join_timestamp: u64,
    /// Number of entries for Snowball games (multiple rolls)
    pub entry_count: u32,
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

/// Unchanged subtree verification data
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubtreeProof {
    /// Root hash of the unchanged subtree
    pub subtree_root: [u8; 32],
    /// Position/index of this subtree in the overall tree
    pub subtree_position: u32,
    /// Level in the tree where this subtree exists
    pub tree_level: u32,
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

    /// Validates fee percentage is within acceptable range (0-100)
    pub fn is_valid_fee_percentage(&self, fee_percentage: u8) -> bool {
        fee_percentage <= 100
    }

    /// Validates timeout configuration (max >= min)
    pub fn is_valid_timeout(&self, max_timeout: u32, min_timeout: u32) -> bool {
        max_timeout >= min_timeout
    }

    /// Validates players count is greater than zero
    pub fn is_valid_players_count(&self, max_players: u32) -> bool {
        max_players > 0
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
    pub fn initialize(&mut self, min_amount: u64, enabled: bool) {
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
    pub fn verify_secret_key(&self, random_hash: [u8; 32], secret_key: [u8; 32]) -> bool {
        let random_hash_calculated = hash(secret_key.as_ref()).to_bytes();
        random_hash_calculated == random_hash
    }

    /// Calculates the winner index using secret key with unbiased random selection
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> u32 {
        // For Snowball games, use total entries (total_amount / ticket_amount)
        // For other games, use unique players count
        let n_entries = if self.game_type == GameType::Snowball {
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

    // =============================================================================
    // MERKLE TREE FUNCTIONS
    // =============================================================================

    /// Creates a participation entry for a new player
    pub fn create_participation_entry(
        player: Pubkey,
        amount: u64,
        player_index: u32,
        timestamp: u64,
        entry_count: u32,
    ) -> ParticipationEntry {
        ParticipationEntry {
            player,
            amount,
            player_index,
            join_timestamp: timestamp,
            entry_count,
        }
    }

    /// Calculates hash of a participation entry (merkle tree leaf)
    pub fn hash_participation_entry(entry: &ParticipationEntry) -> [u8; 32] {
        use anchor_lang::solana_program::hash::hash;
        let serialized = entry.try_to_vec().unwrap();
        hash(&serialized).to_bytes()
    }

    /// Verifies a merkle proof for a given leaf
    pub fn verify_merkle_proof(
        leaf: [u8; 32],
        proof: &[[u8; 32]],
        root: [u8; 32],
        leaf_index: u32,
    ) -> bool {
        use anchor_lang::solana_program::hash::hash;
        
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

        current_hash == root
    }

    /// Calculates the path from leaf to root that will be affected by insertion
    pub fn get_affected_path(leaf_index: u32, max_depth: u32) -> Vec<u32> {
        let mut path = Vec::new();
        let mut current = leaf_index;
        
        for _ in 0..max_depth {
            path.push(current);
            if current == 0 {
                break;
            }
            current = current / 2;
        }
        path
    }

    /// Verifies incremental merkle tree update with unchanged subtrees
    pub fn verify_incremental_update(
        &self,
        old_root: [u8; 32],
        new_root: [u8; 32],
        new_participation: &ParticipationEntry,
        unchanged_subtrees: &[SubtreeProof],
    ) -> Result<()> {
        // 1. Verify new player is being inserted at correct index
        require!(
            new_participation.player_index == self.players_count,
            crate::error::ErrorCode::InvalidPlayersCount
        );

        // 2. Calculate new leaf hash
        let new_leaf = Self::hash_participation_entry(new_participation);

        // 3. Calculate tree depth needed for current players + 1
        let total_players = self.players_count + 1;
        let tree_depth = if total_players <= 1 {
            0
        } else {
            (32 - (total_players - 1).leading_zeros()) as u32
        };

        // 4. Get path that will be affected by this insertion
        let affected_path = Self::get_affected_path(new_participation.player_index, tree_depth);

        // 5. Verify unchanged subtrees are not on affected path
        for subtree in unchanged_subtrees {
            require!(
                !affected_path.contains(&subtree.subtree_position),
                crate::error::ErrorCode::InvalidAmount // TODO: Add better error
            );
        }

        // 6. For first player, tree is just the leaf
        if self.players_count == 0 {
            require!(old_root == [0; 32], crate::error::ErrorCode::InvalidAmount);
            require!(new_root == new_leaf, crate::error::ErrorCode::InvalidAmount);
            return Ok(());
        }

        // 7. Reconstruct new tree using unchanged subtrees + new insertion
        let calculated_new_root = self.reconstruct_tree_with_insertion(
            old_root,
            new_leaf,
            new_participation.player_index,
            unchanged_subtrees,
            tree_depth,
        )?;

        // 8. Verify calculated root matches claimed root
        require!(
            calculated_new_root == new_root,
            crate::error::ErrorCode::InvalidAmount // TODO: Add better error
        );

        Ok(())
    }

    /// Reconstructs merkle tree with new insertion and unchanged subtrees
    fn reconstruct_tree_with_insertion(
        &self,
        old_root: [u8; 32],
        new_leaf: [u8; 32],
        insert_index: u32,
        unchanged_subtrees: &[SubtreeProof],
        tree_depth: u32,
    ) -> Result<[u8; 32]> {
        use anchor_lang::solana_program::hash::hash;

        // Handle simple cases
        if self.players_count == 0 {
            return Ok(new_leaf);
        }
        
        if self.players_count == 1 && insert_index == 1 {
            let combined = [old_root, new_leaf].concat();
            return Ok(hash(&combined).to_bytes());
        }

        // For larger trees, we need to reconstruct the tree level by level
        // This is a complete implementation for binary merkle trees
        
        let total_leaves = self.players_count + 1;
        let mut tree_nodes: Vec<Vec<[u8; 32]>> = vec![vec![[0; 32]; total_leaves as usize]];
        
        // Set the new leaf at its position
        tree_nodes[0][insert_index as usize] = new_leaf;
        
        // Use unchanged subtrees to fill in known values
        for subtree in unchanged_subtrees {
            if subtree.tree_level < tree_depth {
                let level = subtree.tree_level as usize;
                let pos = subtree.subtree_position as usize;
                
                // Ensure we have enough levels
                while tree_nodes.len() <= level {
                    let prev_level_size = tree_nodes[tree_nodes.len() - 1].len();
                    let new_level_size = (prev_level_size + 1) / 2;
                    tree_nodes.push(vec![[0; 32]; new_level_size]);
                }
                
                if pos < tree_nodes[level].len() {
                    tree_nodes[level][pos] = subtree.subtree_root;
                }
            }
        }
        
        // Build tree bottom-up
        for level in 0..tree_depth as usize {
            let current_level_size = tree_nodes[level].len();
            let next_level_size = (current_level_size + 1) / 2;
            
            if tree_nodes.len() <= level + 1 {
                tree_nodes.push(vec![[0; 32]; next_level_size]);
            }
            
            for i in 0..next_level_size {
                let left_idx = i * 2;
                let right_idx = left_idx + 1;
                
                if left_idx < current_level_size {
                    let left = tree_nodes[level][left_idx];
                    let right = if right_idx < current_level_size {
                        tree_nodes[level][right_idx]
                    } else {
                        [0; 32] // Padding for odd number of nodes
                    };
                    
                    if left != [0; 32] || right != [0; 32] {
                        let combined = [left, right].concat();
                        tree_nodes[level + 1][i] = hash(&combined).to_bytes();
                    }
                }
            }
        }
        
        // Return root
        if let Some(root_level) = tree_nodes.last() {
            if !root_level.is_empty() {
                return Ok(root_level[0]);
            }
        }
        
        Err(crate::error::ErrorCode::InvalidAmount.into())
    }

    /// Adds a player to the merkle tree and updates the root
    pub fn add_player_to_merkle_tree(
        &mut self,
        participation: &ParticipationEntry,
        new_merkle_root: [u8; 32],
        unchanged_subtrees: &[SubtreeProof],
    ) -> Result<()> {
        // Verify the incremental update is valid
        self.verify_incremental_update(
            self.merkle_root,
            new_merkle_root,
            participation,
            unchanged_subtrees,
        )?;

        // Update game state
        self.merkle_root = new_merkle_root;
        self.players_count += 1;
        self.total_amount += participation.amount;

        Ok(())
    }
}
