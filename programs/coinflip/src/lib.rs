use anchor_lang::prelude::*;

mod error;
mod instructions;
mod state;

use crate::instructions::*;
use crate::state::GameType;

declare_id!("BzU9WwzqMoDSTTdTurweMLp2tAciFpZaNL2bPUitwNyy");

#[program]
pub mod coinflip {
    use super::*;

    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        fee_percentage: u8,
        oracle_buffer_time: u16,
        max_players: u16,
        max_timeout: u32,
        min_timeout: u32,
    ) -> Result<()> {
        instructions::initialize_oracle::handler(
            ctx,
            fee_percentage,
            oracle_buffer_time,
            max_players,
            max_timeout,
            min_timeout,
        )
    }

    pub fn update_oracle(
        ctx: Context<UpdateOracle>,
        fee_percentage: u8,
        oracle_buffer_time: u16,
        max_players: u16,
        max_timeout: u32,
        min_timeout: u32,
    ) -> Result<()> {
        instructions::update_oracle::handler(
            ctx,
            fee_percentage,
            oracle_buffer_time,
            max_players,
            max_timeout,
            min_timeout,
        )
    }

    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        ticker: String,
        min_amount: u64,
        enabled: bool,
    ) -> Result<()> {
        instructions::initialize_token::handler(ctx, ticker, min_amount, enabled)
    }

    pub fn update_token(
        ctx: Context<UpdateToken>,
        ticker: String,
        min_amount: u64,
        enabled: bool,
    ) -> Result<()> {
        instructions::update_token::handler(ctx, ticker, min_amount, enabled)
    }

    pub fn initialize_player_balance(ctx: Context<InitializePlayerBalance>) -> Result<()> {
        instructions::initialize_player_balance::handler(ctx)
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_type: GameType,
        amount: u64,
        max_players: u16,
        min_players: u16,
        timeout: u32,
        is_private: bool,
    ) -> Result<()> {
        instructions::initialize_game::handler(
            ctx,
            game_type,
            amount,
            max_players,
            min_players,
            timeout,
            is_private,
        )
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

    pub fn set_oracle_number(ctx: Context<SetOracleNumber>, _random_number: u64) -> Result<()> {
        instructions::set_oracle_number::handler(ctx)
    }

    pub fn claim_win(ctx: Context<ClaimWin>) -> Result<()> {
        instructions::claim_win::handler(ctx)
    }

    pub fn claim_fee(ctx: Context<ClaimFee>) -> Result<()> {
        instructions::claim_fee::handler(ctx)
    }
}
