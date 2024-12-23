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

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        fee_percentage: u8,
        operator: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, treasury, fee_percentage, operator)
    }

    pub fn initialize_token_config(
        ctx: Context<InitializeTokenConfig>,
        ticker: String,
        allowed : bool,
    ) -> Result<()> {
        instructions::initialize_token_config::handler(ctx, ticker, allowed)
    }

    pub fn update_token_config(
        ctx: Context<UpdateTokenConfig>,
        ticker: String,
        allowed: bool,
    ) -> Result<()> {
        instructions::update_token_config::handler(ctx, ticker, allowed)
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        creator_telegram_id: Option<String>,
        telegram_group_id: Option<String>,
        game_type: GameType,
        amount: u64,
        max_players: u16,
        min_players: u16,
        timeout: i64,
        is_private: bool,
    ) -> Result<()> {
        instructions::initialize_game::handler(
            ctx,
            creator_telegram_id,
            telegram_group_id,
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

    pub fn set_oracle_hash(ctx: Context<SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
        instructions::set_oracle_hash::handler(ctx, hash_value)
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        instructions::claim_winnings::handler(ctx)
    }

    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        instructions::cancel_game::handler(ctx)
    }

    pub fn initialize_telegram_user(
        ctx: Context<InitializeTelegramUser>,
        telegram_id: String,
    ) -> Result<()> {
        instructions::initialize_telegram_user::handler(ctx, telegram_id)
    }
}
