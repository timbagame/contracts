use anchor_lang::prelude::*;

mod error;
mod instructions;
mod state;
mod utils;

use crate::instructions::*;
use crate::state::GameType;

declare_id!("BzU9WwzqMoDSTTdTurweMLp2tAciFpZaNL2bPUitwNyy");

#[constant]
pub const MAX_FEE_PERCENTAGE: u64 = 5;
pub const MAX_PARTICIPANTS: u8 = 100;
pub const BUFFER_SIZE: usize = 64;

#[program]
pub mod coinflip {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        game_token: Pubkey,
        fee_percentage: u64,
        operator: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            treasury,
            game_token,
            fee_percentage,
            operator,
        )
    }

    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::update_authority::handler(ctx, new_authority)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_treasury: Option<Pubkey>,
        new_game_token: Option<Pubkey>,
        new_fee_percentage: Option<u64>,
        new_operator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_config::handler(
            ctx,
            new_treasury,
            new_game_token,
            new_fee_percentage,
            new_operator,
        )
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_type: GameType,
        amount: u64,
        max_participants: u8,
        timeout_duration: i64,
        is_private: bool,
    ) -> Result<()> {
        instructions::initialize_game::handler(
            ctx,
            game_type,
            amount,
            max_participants,
            timeout_duration,
            is_private,
        )
    }

    pub fn join_game(ctx: Context<JoinGame>, signature: Option<Vec<u8>>) -> Result<()> {
        instructions::join_game::handler(ctx, signature)
    }

    pub fn set_oracle_hash(ctx: Context<SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
        instructions::set_oracle_hash::handler(ctx, hash_value)
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        instructions::claim_winnings::handler(ctx)
    }

    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        instructions::claim_timeout::handler(ctx)
    }

    pub fn collect_fees(ctx: Context<CollectFees>, amount: u64) -> Result<()> {
        instructions::collect_fees::handler(ctx, amount)
    }
}
