use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UpdateConfig>,
    fee_percentage: u8,
    operator: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.fee_percentage = fee_percentage;
    config.operator = operator;

    Ok(())
} 