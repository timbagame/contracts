use crate::{error::ErrorCode, GameConfig};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{close_account, transfer_checked, CloseAccount, TransferChecked};
use solana_sha256_hasher::hashv;

// =============================================================================
// ACCOUNT SIZE CONSTANTS
// =============================================================================

// discriminator (8) + operator (32) + fee_percentage (1) +
// oracle_buffer_time (u64: 8) + max_tickets (u32: 4) +
// max_timeout (u64: 8) + min_timeout (u64: 8)
pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 8 + 4 + 8 + 8;

// =============================================================================
// ENTROPY CONSTANTS
// =============================================================================
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

/// Minimum players required for competitive games
pub const MIN_COMPETITIVE_PLAYERS: u32 = 2;
/// Minimum players required for giveaway games
pub const MIN_GIVEAWAY_PLAYERS: u32 = 1;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 1 + 8 + 8 + 1;
/// Base size of Game excluding variable-length Vec data
pub const GAME_BASE_SIZE: usize = 8
    + 32 // creator
    + 1  // game_type
    + 8  // ticket_amount
    + 4  // max_tickets
    + 4  // min_tickets
    + 4  // tickets_count
    + 32 // token_mint
    + 8  // created_at
    + 8  // timeout (u64)
    + 8  // last_slot
    + 1  // is_private
    + 8; // total_amount

// =============================================================================
// GAME TYPES
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
#[repr(u8)]
pub enum GameType {
    /// Two or more players compete for the pot
    Coinflip,
    /// One or more players compete for a giveaway prize provided by the creator
    Giveaway,
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
    /// Percentage of game amount taken as fee (0-10)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout before cancellation is allowed
    pub oracle_buffer_time: u64,
    /// Maximum number of tickets allowed in a game
    pub max_tickets: u32,
    /// Maximum timeout duration in seconds for a game
    pub max_timeout: u64,
    /// Minimum timeout duration in seconds for a game
    pub min_timeout: u64,
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
    pub fn is_valid_timeout_range(&self, timeout: u64) -> bool {
        timeout >= self.min_timeout && timeout <= self.max_timeout
    }

    /// Validates fee percentage is within valid range (0-10)
    pub fn is_valid_fee_percentage(fee_percentage: u8) -> bool {
        fee_percentage <= 10
    }

    /// Validates oracle buffer time is strictly positive
    pub fn is_valid_buffer_time(oracle_buffer_time: u64) -> bool {
        oracle_buffer_time > 0
    }

    /// Validates timeout parameters are in correct order
    pub fn is_valid_timeout(max_timeout: u64, min_timeout: u64) -> bool {
        max_timeout >= min_timeout
    }

    /// Validates ticket count is positive
    pub fn is_valid_tickets_count(max_tickets: u32) -> bool {
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

    /// Accrues protocol fees, guarding against overflow.
    pub fn accrue_fee(&mut self, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }

        self.fee_amount = self
            .fee_amount
            .checked_add(amount)
            .ok_or(ErrorCode::InvalidAmount)?;
        Ok(())
    }

    /// Returns all accumulated fees and resets the counter.
    pub fn drain_fees(&mut self) -> u64 {
        let fees = self.fee_amount;
        self.fee_amount = 0;
        fees
    }

    /// Generalized token transfer helper (reduces duplication of PDA vs player authority logic)
    /// If `use_pda_signer` is true, signs the CPI with the game vault PDA seeds.
    pub fn handle_token_transfer<'info>(
        &self,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>, // player or PDA
        token_program: AccountInfo<'info>,
        token_mint: AccountInfo<'info>,
        amount: u64,
        decimals: u8,
        use_pda_signer: bool,
    ) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }

        if use_pda_signer {
            let signer_seeds = &[
                GAME_VAULT_SEED,
                self.token_mint.as_ref(),
                &[self.vault_bump],
            ];
            transfer_checked(
                CpiContext::new_with_signer(
                    token_program.key(),
                    TransferChecked {
                        from,
                        mint: token_mint,
                        to,
                        authority,
                    },
                    &[signer_seeds],
                ),
                amount,
                decimals,
            )?;
        } else {
            transfer_checked(
                CpiContext::new(
                    token_program.key(),
                    TransferChecked {
                        from,
                        mint: token_mint,
                        to,
                        authority,
                    },
                ),
                amount,
                decimals,
            )?;
        }
        Ok(())
    }

    /// Closes the PDA-owned vault ATA and returns rent to destination.
    pub fn close_vault_account<'info>(
        &self,
        vault_account: AccountInfo<'info>,
        destination: AccountInfo<'info>,
        vault_authority: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
    ) -> Result<()> {
        let signer_seeds = &[
            GAME_VAULT_SEED,
            self.token_mint.as_ref(),
            &[self.vault_bump],
        ];
        close_account(CpiContext::new_with_signer(
            token_program.key(),
            CloseAccount {
                account: vault_account,
                destination,
                authority: vault_authority,
            },
            &[signer_seeds],
        ))?;
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
    pub timeout: u64,
    /// Last slot when any player action occurred
    pub last_slot: u64,
    /// Whether this is a private game requiring oracle approval
    pub is_private: bool,
    /// Total accumulated prize
    pub total_amount: u64,
    /// Exact participant public keys in canonical join order
    pub participants: Vec<Pubkey>,
}

impl Game {
    // =============================================================================
    // CORE GAME LIFECYCLE METHODS
    // =============================================================================

    /// Initializes a freshly created game account from configuration.
    pub fn initialize(
        &mut self,
        creator: Pubkey,
        token_mint: Pubkey,
        config: &GameConfig,
        created_at: u64,
        slot: u64,
    ) {
        self.creator = creator;
        self.game_type = config.game_type;
        self.max_tickets = config.max_tickets;
        self.min_tickets = config.min_tickets;
        self.tickets_count = 0;
        self.token_mint = token_mint;
        self.created_at = created_at;
        self.timeout = config.timeout;
        self.last_slot = slot;
        self.is_private = config.is_private;

        match config.game_type {
            GameType::Giveaway => {
                self.total_amount = config.amount;
                self.ticket_amount = 0;
            }
            _ => {
                self.total_amount = 0;
                self.ticket_amount = config.amount;
            }
        }

        self.participants.clear();
    }

    /// Checks if the game has exceeded its timeout duration
    pub fn is_expired(&self, current_time: u64) -> bool {
        let expiry = self.created_at.saturating_add(self.timeout);
        current_time >= expiry
    }

    /// Checks if the game meets requirements to be completed by oracle
    pub fn is_ready_for_completion(&self, current_time: u64) -> bool {
        let has_min_tickets = self.tickets_count >= self.min_tickets;
        let has_max_tickets = self.tickets_count == self.max_tickets;
        let timeout_reached = self.is_expired(current_time);

        // Game is ready if it has max tickets OR (min tickets AND timeout reached)
        has_max_tickets || (has_min_tickets && timeout_reached)
    }

    /// Returns the timestamp when the oracle buffer window ends
    fn buffer_expires_at(&self, oracle_buffer_time: u64) -> u64 {
        let timeout_at = self.created_at.saturating_add(self.timeout);
        timeout_at.saturating_add(oracle_buffer_time)
    }

    /// Checks if oracle buffer time has expired (game is no longer completable)
    pub fn is_buffer_expired(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        let expires_at = self.buffer_expires_at(oracle_buffer_time);
        // `Clock::unix_timestamp` is second-resolution, so callers frequently hit the
        // exact expiry moment. Treat the equality case as expired; otherwise players
        // cannot unjoin until the next whole second elapses.
        current_time >= expires_at
    }

    /// Checks if the game is waiting for oracle to complete it
    pub fn waiting_for_oracle(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        // If game is already completed, no need to wait for oracle
        if self.total_amount == 0 {
            return false;
        }

        let expires_at = self.buffer_expires_at(oracle_buffer_time);

        // Mirror `is_buffer_expired` so the two helpers are complementary. Once the
        // buffer expiry second is reached we should stop reporting "waiting".
        let still_waiting = if oracle_buffer_time == 0 {
            current_time <= expires_at
        } else {
            current_time < expires_at
        };

        self.is_ready_for_completion(current_time) && still_waiting
    }

    /// Determines if players can unjoin at the current moment.
    pub fn can_unjoin(&self, oracle_buffer_time: u64, current_time: u64) -> bool {
        self.is_buffer_expired(oracle_buffer_time, current_time)
            || !self.waiting_for_oracle(oracle_buffer_time, current_time)
    }

    /// Marks the game as completed by setting total_amount to zero
    pub fn complete(&mut self) {
        self.total_amount = 0;
    }

    /// Verifies the secret key matches the random hash using SHA256
    pub fn verify_secret_key(random_hash: [u8; 32], secret_key: [u8; 32]) -> bool {
        let random_hash_calculated = hashv(&[secret_key.as_ref()]).to_bytes();
        random_hash_calculated == random_hash
    }

    /// Calculates the winner index using secret key with unbiased random selection
    pub fn calculate_winner_index(&self, secret_key: [u8; 32]) -> Option<u32> {
        // Use total tickets count for all game types
        let n_entries = self.tickets_count as u64;

        if n_entries == 1 {
            return Some(0);
        }

        // Hash secret and slot together without allocation
        let slot_bytes = self.last_slot.to_le_bytes();
        let entropy_hash = hashv(&[secret_key.as_ref(), &slot_bytes]).to_bytes();

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

    /// Add player to the game and update counters
    pub fn add_player_to_game(&mut self, participant: Pubkey) -> Result<u32> {
        if self.tickets_count >= self.max_tickets {
            return err!(ErrorCode::InvalidAmount);
        }

        self.ensure_participant_capacity()?;

        let ticket_index = self.tickets_count;
        self.participants.push(participant);

        let new_tickets_count = self
            .tickets_count
            .checked_add(1)
            .ok_or(ErrorCode::InvalidAmount)?;

        let new_total_amount = self
            .total_amount
            .checked_add(self.ticket_amount)
            .ok_or(ErrorCode::InvalidAmount)?;

        self.tickets_count = new_tickets_count;
        self.total_amount = new_total_amount;

        Ok(ticket_index)
    }

    fn ensure_participant_capacity(&mut self) -> Result<()> {
        let required = self.max_tickets as usize;
        if self.participants.capacity() >= required {
            return Ok(());
        }

        let additional = required
            .checked_sub(self.participants.capacity())
            .ok_or(ErrorCode::ParticipantStorageExceeded)?;

        self.participants
            .try_reserve(additional)
            .map_err(|_| ErrorCode::ParticipantStorageExceeded)?;

        Ok(())
    }

    pub fn remove_player_at(&mut self, index: usize) -> Result<()> {
        if self.tickets_count == 0 {
            return err!(ErrorCode::InvalidTicketsCount);
        }

        if index >= self.participants.len() {
            return err!(ErrorCode::InvalidAmount);
        }

        self.participants.swap_remove(index);

        self.tickets_count = self
            .tickets_count
            .checked_sub(1)
            .ok_or(ErrorCode::InvalidAmount)?;

        self.total_amount = self
            .total_amount
            .checked_sub(self.ticket_amount)
            .ok_or(ErrorCode::InvalidAmount)?;

        Ok(())
    }

    pub fn active_participants(&self) -> &[Pubkey] {
        let len = self.participants.len().min(self.tickets_count as usize);
        &self.participants[..len]
    }

    /// Returns true if the participant already exists in the active set.
    pub fn contains_participant(&self, participant: &Pubkey) -> bool {
        self.participant_index(participant).is_some()
    }

    /// Returns the index of the participant if it is present.
    pub fn participant_index(&self, participant: &Pubkey) -> Option<usize> {
        self.active_participants()
            .iter()
            .position(|existing| existing == participant)
    }

    /// Removes the participant and returns the index removed.
    pub fn remove_participant(&mut self, participant: &Pubkey) -> Result<usize> {
        if self.tickets_count == 0 {
            return err!(ErrorCode::InvalidTicketsCount);
        }

        let index = self
            .participant_index(participant)
            .ok_or(ErrorCode::UnauthorizedPlayer)?;
        self.remove_player_at(index)?;
        Ok(index)
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
        if matches!(game_type, GameType::Giveaway) {
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
        self.game_type == GameType::Giveaway || token_balance >= self.ticket_amount
    }
}
