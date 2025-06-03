#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

mod error;
mod instructions;
mod state;
mod utils;

use crate::instructions::*;
use crate::state::GameType;

declare_id!("CTokUBpwvUL1xcMMpXTdiz7ceuRkbiS7KAs4hFFFUKZV");

// Configuration struct for oracle settings
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OracleConfig {
    pub fee_percentage: u8,
    pub oracle_buffer_time: u16,
    pub max_players: u8,
    pub max_timeout: u32,
    pub min_timeout: u32,
}

// Configuration struct for token settings
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenConfig {
    pub min_amount: u64,
    pub enabled: bool,
}

// Configuration struct for game settings
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GameConfig {
    pub game_type: GameType,
    pub amount: u64,
    pub max_players: u8,
    pub min_players: u8,
    pub timeout: u32,
    pub is_private: bool,
}

#[program]
pub mod coinflip {
    use super::*;

    // Oracle Management
    // ----------------

    pub fn initialize_oracle(ctx: Context<InitializeOracle>, config: OracleConfig) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, config)
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>, config: OracleConfig) -> Result<()> {
        instructions::update_oracle::handler(ctx, config)
    }

    // Token Management
    // ---------------

    pub fn initialize_token(ctx: Context<InitializeToken>, config: TokenConfig) -> Result<()> {
        instructions::initialize_token::handler(ctx, config)
    }

    pub fn update_token(ctx: Context<UpdateToken>, config: TokenConfig) -> Result<()> {
        instructions::update_token::handler(ctx, config)
    }

    // Player Management
    // ----------------

    pub fn initialize_player_balance(ctx: Context<InitializePlayerBalance>) -> Result<()> {
        instructions::initialize_player_balance::handler(ctx)
    }

    pub fn withdraw_player_balance(ctx: Context<WithdrawPlayerBalance>) -> Result<()> {
        instructions::withdraw_player_balance::handler(ctx)
    }

    // Game Management
    // --------------

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        config: GameConfig,
        _random_hash: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_game::handler(ctx, config)
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        instructions::join_game::handler(ctx)
    }

    pub fn unjoin_game(ctx: Context<UnjoinGame>) -> Result<()> {
        instructions::unjoin_game::handler(ctx)
    }

    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        instructions::cancel_game::handler(ctx)
    }

    pub fn complete_game(ctx: Context<CompleteGame>, _secret_key: [u8; 64]) -> Result<()> {
        instructions::complete_game::handler(ctx)
    }

    // Fee Management
    // -------------

    pub fn withdraw_token_fee(ctx: Context<WithdrawTokenFee>) -> Result<()> {
        instructions::withdraw_token_fee::handler(ctx)
    }
}
