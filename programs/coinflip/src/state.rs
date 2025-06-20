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
pub const GAME_SIZE: usize =
    8 + 32 + 1 + 8 + 4 + 4 + 4 + 32 + 8 + 4 + 8 + 1 + 8 + 32 + 4 + 512 + 4 + 640 + 4 + 128; // Zero-proof merkle data

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

/// Stable cached proof data for frequently reused subtrees
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StableProof {
    /// Hash of the stable subtree
    pub hash: [u8; 32],
    /// Level in the tree where this subtree exists
    pub level: u8,
    /// Position/index of this subtree at this level
    pub position: u32,
    /// Player count when this became stable
    pub stable_at_player_count: u32,
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
    /// Pre-calculated proof for the next player join
    pub next_join_proof: Vec<[u8; 32]>,
    /// Cached stable proofs for frequently reused subtrees
    pub stable_proofs: Vec<StableProof>,
    /// Player count thresholds for next stable proof at each level
    pub next_stable_thresholds: Vec<u32>,
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

    /// Adds a player to the merkle tree
    pub fn add_player_to_merkle_tree(&mut self, player: Pubkey, timestamp: u64) -> Result<()> {
        // Create participation entry internally
        let participation = Self::create_participation_entry(player, self.players_count, timestamp);

        // Use pre-calculated proof to verify the join
        let proof = self.next_join_proof.clone();

        // Calculate leaf hash
        let leaf_hash = Self::hash_participation_entry(&participation);

        // Verify merkle proof
        require!(
            self.verify_merkle_proof(leaf_hash, &proof, participation.player_index),
            crate::error::ErrorCode::InvalidAmount
        );

        // Update merkle root by reconstructing with new leaf
        self.merkle_root =
            self.calculate_new_root_with_leaf(leaf_hash, participation.player_index, &proof);

        // Update game state
        self.players_count += 1;
        self.total_amount += self.ticket_amount; // Use ticket_amount from game

        // Update stable proof cache if we hit thresholds
        self.update_stable_proof_cache()?;

        // Calculate and store proof for next join
        self.calculate_and_store_next_proof()?;

        Ok(())
    }

    /// Calculates new merkle root with a new leaf at given index
    fn calculate_new_root_with_leaf(
        &self,
        leaf_hash: [u8; 32],
        leaf_index: u32,
        proof: &[[u8; 32]],
    ) -> [u8; 32] {
        let mut current_hash = leaf_hash;
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

        current_hash
    }

    /// Updates stable proof cache when thresholds are hit
    fn update_stable_proof_cache(&mut self) -> Result<()> {
        let current_player_count = self.players_count;

        // Collect updates to avoid borrowing conflicts
        let mut updates = Vec::new();

        for (level, threshold) in self.next_stable_thresholds.iter().enumerate() {
            if current_player_count == *threshold {
                // Calculate stable subtree hash at this level
                let stable_hash = self.calculate_stable_subtree_hash(level as u8)?;
                let position = self.calculate_stable_position(level as u8);

                updates.push((
                    level,
                    StableProof {
                        hash: stable_hash,
                        level: level as u8,
                        position,
                        stable_at_player_count: current_player_count,
                    },
                    self.calculate_next_threshold(level as u8),
                ));
            }
        }

        // Apply updates
        for (level, stable_proof, new_threshold) in updates {
            self.stable_proofs.push(stable_proof);
            self.next_stable_thresholds[level] = new_threshold;
        }

        Ok(())
    }

    /// Calculates and stores the proof needed for the next player join
    fn calculate_and_store_next_proof(&mut self) -> Result<()> {
        let next_player_index = self.players_count;
        let tree_depth = self.calculate_tree_depth();

        let mut next_proof = Vec::new();
        let mut current_index = next_player_index;

        for level in 0..tree_depth {
            let sibling_index = current_index ^ 1; // XOR to get sibling

            // Get sibling hash from stable cache or calculate it
            let sibling_hash =
                if let Some(stable_proof) = self.find_stable_proof(level as u8, sibling_index) {
                    stable_proof.hash
                } else {
                    self.calculate_current_sibling_hash(level as u8, sibling_index)?
                };

            next_proof.push(sibling_hash);
            current_index /= 2;
        }

        self.next_join_proof = next_proof;
        Ok(())
    }

    /// Initialize merkle system for new game
    pub fn initialize_merkle_system(&mut self, max_players: u32) -> Result<()> {
        // Initialize empty proof cache
        self.stable_proofs = Vec::new();
        self.next_join_proof = Vec::new();

        // Calculate thresholds for each level
        let tree_depth = if max_players <= 1 {
            1
        } else {
            (32 - (max_players - 1).leading_zeros()) as usize
        };
        self.next_stable_thresholds = Vec::with_capacity(tree_depth);

        for level in 0..tree_depth {
            let threshold = self.calculate_next_threshold(level as u8);
            self.next_stable_thresholds.push(threshold);
        }

        Ok(())
    }

    // Helper functions
    fn calculate_tree_depth(&self) -> u32 {
        if self.players_count <= 1 {
            1
        } else {
            32 - (self.players_count - 1).leading_zeros()
        }
    }

    fn calculate_next_threshold(&self, level: u8) -> u32 {
        let current_count = self.players_count;
        let level_size = 1u32 << (level + 1);
        ((current_count / level_size) + 1) * level_size
    }

    fn find_stable_proof(&self, level: u8, position: u32) -> Option<&StableProof> {
        self.stable_proofs
            .iter()
            .find(|proof| proof.level == level && proof.position == position)
    }

    fn calculate_stable_subtree_hash(&self, _level: u8) -> Result<[u8; 32]> {
        // Placeholder - implement actual stable subtree calculation
        Ok([0; 32])
    }

    fn calculate_stable_position(&self, level: u8) -> u32 {
        // Calculate position of stable subtree at given level
        (self.players_count - 1) >> (level + 1)
    }

    fn calculate_current_sibling_hash(&self, _level: u8, _sibling_index: u32) -> Result<[u8; 32]> {
        // Placeholder - implement calculation from current tree state and stable proofs
        Ok([0; 32])
    }
}
