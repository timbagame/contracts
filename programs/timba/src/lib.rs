#![allow(unexpected_cfgs)]
#![deny(unused_must_use)]
#![warn(clippy::all, clippy::pedantic)]

use anchor_lang::prelude::*;

// =============================================================================
// MODULE DECLARATIONS
// =============================================================================

mod error;
mod events;
mod instructions;
mod state;
mod utils;

use crate::instructions::*;
use crate::state::GameType;

// =============================================================================
// PROGRAM ID
// =============================================================================

declare_id!("BpdzqWdNJfgeVCsFHppS4WgeRZSRxt5iSj6xH4QdeR7t");

// =============================================================================
// CONFIGURATION STRUCTS
// =============================================================================

/// Configuration parameters for oracle initialization and updates
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OracleConfig {
    /// Fee percentage taken from game winnings (0-100)
    pub fee_percentage: u8,
    /// Buffer time in seconds after game timeout before cancellation
    pub oracle_buffer_time: u64,
    /// Maximum number of tickets allowed in any game
    pub max_tickets: u32,
    /// Maximum timeout duration in seconds for games
    pub max_timeout: u64,
    /// Minimum timeout duration in seconds for games
    pub min_timeout: u64,
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
    /// Maximum number of tickets allowed
    pub max_tickets: u32,
    /// Minimum number of tickets required to complete
    pub min_tickets: u32,
    /// Timeout duration in seconds
    pub timeout: u64,
    /// Whether game requires oracle operator to join
    pub is_private: bool,
}

// =============================================================================
// PROGRAM ENTRY POINTS
// =============================================================================

#[program]
pub mod timba {
    use super::*;

    // =========================================================================
    // ORACLE MANAGEMENT
    // =========================================================================

    /// Initializes the global oracle account with fee settings and constraints
    pub fn initialize_oracle(ctx: Context<InitializeOracle>, config: OracleConfig) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, config)
    }

    /// Updates oracle configuration including operator transfer
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

    // =========================================================================
    // GAME MANAGEMENT
    // =========================================================================

    /// Creates a new game with specified configuration
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

    /// Allows a player to leave a game before completion (with refund)
    pub fn unjoin_game(ctx: Context<UnjoinGame>) -> Result<()> {
        instructions::unjoin_game::handler(ctx)
    }

    /// Closes a game with no active players (creator only)
    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        instructions::close_game::handler(ctx)
    }

    /// Completes a game by revealing the secret key and distributing winnings
    pub fn complete_game(
        ctx: Context<CompleteGame>,
        _random_hash: [u8; 32],
        secret_key: [u8; 32],
        winner_index: u32,
    ) -> Result<()> {
        instructions::complete_game::handler(ctx, _random_hash, secret_key, winner_index)
    }

    // =========================================================================
    // FEE MANAGEMENT
    // =========================================================================

    /// Allows oracle operator to withdraw accumulated fees for a token
    pub fn withdraw_token_fee(ctx: Context<WithdrawTokenFee>) -> Result<()> {
        instructions::withdraw_token_fee::handler(ctx)
    }
}
