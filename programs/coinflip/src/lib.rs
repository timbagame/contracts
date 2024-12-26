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

    pub fn initialize_oracle(ctx: Context<InitializeOracle>, fee_percentage: u8) -> Result<()> {
        instructions::initialize_oracle::handler(ctx, fee_percentage)
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>, fee_percentage: u8) -> Result<()> {
        instructions::update_oracle::handler(ctx, fee_percentage)
    }

    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        ticker: String,
        enabled: bool,
    ) -> Result<()> {
        instructions::initialize_token::handler(ctx, ticker, enabled)
    }

    pub fn update_token(ctx: Context<UpdateToken>, ticker: String, enabled: bool) -> Result<()> {
        instructions::update_token::handler(ctx, ticker, enabled)
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_type: GameType,
        amount: u64,
        max_players: u16,
        min_players: u16,
        timeout: i64,
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

    pub fn set_oracle_hash(ctx: Context<SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
        instructions::set_oracle_hash::handler(ctx, hash_value)
    }

    pub fn claim_win(ctx: Context<ClaimWin>, max_transfers: u64) -> Result<()> {
        instructions::claim_win::handler(ctx, max_transfers)
    }

    pub fn initialize_player(
        ctx: Context<InitializePlayer>,
        owner: Pubkey,
        bot_type: u8,
        bot_seed: String,
        bot_auth: bool,
    ) -> Result<()> {
        instructions::initialize_player::handler(ctx, owner, bot_type, bot_seed, bot_auth)
    }
}
