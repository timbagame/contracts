use crate::error::ErrorCode;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeConfig>,
    treasury: Pubkey,
    fee_percentage: u64,
    operator: Pubkey,
) -> Result<()> {
    // Validate fee percentage is not greater than 5
    require!(fee_percentage <= 5, ErrorCode::InvalidFeePercentage);

    let config = &mut ctx.accounts.config;
    config.treasury = treasury;
    config.fee_percentage = fee_percentage;
    config.operator = operator;

    Ok(())
}
