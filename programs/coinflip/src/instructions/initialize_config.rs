use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::MAX_FEE_PERCENTAGE;

pub fn handler(
    ctx: Context<super::InitializeConfig>,
    treasury: Pubkey,
    game_token: Pubkey,
    fee_percentage: u64,
    operator: Pubkey,
) -> Result<()> {
    require!(
        fee_percentage <= MAX_FEE_PERCENTAGE,
        ErrorCode::InvalidFeePercentage
    );

    let config = &mut ctx.accounts.config;
    config.treasury = treasury;
    config.game_token = game_token;
    config.fee_percentage = fee_percentage;
    config.authority = ctx.accounts.authority.key();
    config.operator = operator;

    Ok(())
}
