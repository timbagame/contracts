#![deny(unused_must_use)]
#![forbid(unsafe_code)]
#![warn(clippy::all, clippy::pedantic)]
// Anchor entrypoints must own their Context and configuration arguments, and every
// instruction uses Result even when its current handler body is infallible.
#![allow(
    clippy::missing_errors_doc,
    clippy::needless_pass_by_value,
    clippy::pub_underscore_fields,
    clippy::unnecessary_wraps,
    clippy::used_underscore_binding,
    clippy::wildcard_imports
)]

use anchor_lang::prelude::*;

// MODULE DECLARATIONS
//
// `error`, `events`, `state`, and `utils` are public so integration tests
// (LiteSVM) can assert against program types without duplicating logic.

pub mod error;
pub mod events;
mod instructions;
pub mod state;
pub mod utils;

use crate::instructions::*;
use crate::state::GameType;

// PROGRAM ID

declare_id!("32Jr4JnXWvqq9GqPQynkooHsszaucUUvZfNLh2hdX2L5");

// CONFIGURATION STRUCTS

/// Configuration parameters for oracle initialization and updates
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OracleConfig {
    /// Fee percentage taken from game winnings (0-10)
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

// PROGRAM ENTRY POINTS

#[program]
pub mod timba {
    use super::*;

    /// Initializes the global oracle account with fee settings and constraints
    pub fn initialize_oracle(ctx: Context<InitializeOracle>, config: OracleConfig) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, config)
    }

    /// Updates oracle configuration including operator transfer
    pub fn update_oracle(ctx: Context<UpdateOracle>, config: OracleConfig) -> Result<()> {
        instructions::update_oracle::handler(ctx, config)
    }

    /// Closes a current Oracle after all games have been settled
    pub fn close_oracle(ctx: Context<CloseOracle>) -> Result<()> {
        instructions::close_oracle::handler(ctx)
    }

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

    /// Closes an expired game with no participants (Oracle operator only)
    pub fn operator_close_game(ctx: Context<OperatorCloseGame>) -> Result<()> {
        instructions::operator_close_game::handler(ctx)
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
}
