#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

// =============================================================================
// MODULE DECLARATIONS
// =============================================================================

mod error;
mod events;
mod instructions;
mod state;

use crate::instructions::*;
use crate::state::{ExclusionProof, GameType, ParticipationEntry};

// =============================================================================
// PROGRAM ID
// =============================================================================

declare_id!("GLAicVgkhvVtAbcf9aF4iLqAXZ9GSrsfexoDUN2fBPCG");

// =============================================================================
// CONFIGURATION STRUCTS
// =============================================================================

/// Configuration parameters for oracle initialization and updates
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OracleConfig {
    /// Fee percentage taken from game winnings (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout before cancellation
    pub oracle_buffer_time: u16,
    /// Maximum number of players allowed in any game
    pub max_players: u32,
    /// Maximum timeout duration in seconds for games
    pub max_timeout: u32,
    /// Minimum timeout duration in seconds for games
    pub min_timeout: u32,
}

/// Configuration parameters for token initialization and updates
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenConfig {
    /// Minimum amount required to participate in games with this token
    pub min_amount: u64,
    /// Whether this token is enabled for creating/joining games
    pub enabled: bool,
}

/// Configuration parameters for game creation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GameConfig {
    /// Type of game being created
    pub game_type: GameType,
    /// Amount per player (ticket amount for regular games, total prize for giveaways)
    pub amount: u64,
    /// Maximum number of players allowed
    pub max_players: u32,
    /// Minimum number of players required to complete
    pub min_players: u32,
    /// Timeout duration in seconds
    pub timeout: u32,
    /// Whether game requires oracle authority to join
    pub is_private: bool,
}

// =============================================================================
// PROGRAM ENTRY POINTS
// =============================================================================

#[program]
pub mod coinflip {
    use super::*;

    // =========================================================================
    // ORACLE MANAGEMENT
    // =========================================================================

    /// Initializes the global oracle account with fee settings and constraints
    pub fn initialize_oracle(ctx: Context<InitializeOracle>, config: OracleConfig) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, config)
    }

    /// Updates oracle configuration including authority transfer
    pub fn update_oracle(ctx: Context<UpdateOracle>, config: OracleConfig) -> Result<()> {
        instructions::update_oracle::handler(ctx, config)
    }

    // =========================================================================
    // TOKEN MANAGEMENT
    // =========================================================================

    /// Initializes a new token for use in games with minimum amount and enabled status
    pub fn initialize_token(ctx: Context<InitializeToken>, config: TokenConfig) -> Result<()> {
        instructions::initialize_token::handler(ctx, config)
    }

    /// Updates token configuration including minimum amounts and enabled status
    pub fn update_token(ctx: Context<UpdateToken>, config: TokenConfig) -> Result<()> {
        instructions::update_token::handler(ctx, config)
    }

    // =========================================================================
    // PLAYER MANAGEMENT
    // =========================================================================

    /// Initializes a player's balance account for a specific token
    pub fn initialize_player_balance(ctx: Context<InitializePlayerBalance>) -> Result<()> {
        instructions::initialize_player_balance::handler(ctx)
    }

    /// Allows players to withdraw their accumulated balance for a token
    pub fn withdraw_player_balance(ctx: Context<WithdrawPlayerBalance>) -> Result<()> {
        instructions::withdraw_player_balance::handler(ctx)
    }

    // =========================================================================
    // GAME MANAGEMENT
    // =========================================================================

    /// Creates a new game with specified configuration and random hash
    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        config: GameConfig,
        _random_hash: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_game::handler(ctx, config)
    }

    /// Allows a player to join an existing game
    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        instructions::join_game::handler(ctx)
    }

    /// Allows a player to roll in Snowball/Dumbflip games (multiple participation)
    pub fn roll_game(ctx: Context<RollGame>) -> Result<()> {
        instructions::roll_game::handler(ctx)
    }

    /// Allows a player to leave a game before completion (with refund)
    /// Recent players can unjoin directly, subtree players require exclusion proof
    pub fn unjoin_game(
        ctx: Context<UnjoinGame>,
        player_index: u32,
        exclusion_proof: Option<ExclusionProof>,
    ) -> Result<()> {
        instructions::unjoin_game::handler(ctx, player_index, exclusion_proof)
    }

    /// Closes a game with no active players (creator only)
    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        instructions::close_game::handler(ctx)
    }

    /// Completes a game by revealing the secret key and distributing winnings
    pub fn complete_game(
        ctx: Context<CompleteGame>,
        random_hash: [u8; 32],
        secret_key: [u8; 32],
        winner_participation: ParticipationEntry,
        winner_merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::complete_game::handler(
            ctx,
            random_hash,
            secret_key,
            winner_participation,
            winner_merkle_proof,
        )
    }

    // =========================================================================
    // FEE MANAGEMENT
    // =========================================================================

    /// Allows oracle authority to withdraw accumulated fees for a token
    pub fn withdraw_token_fee(ctx: Context<WithdrawTokenFee>) -> Result<()> {
        instructions::withdraw_token_fee::handler(ctx)
    }
}
