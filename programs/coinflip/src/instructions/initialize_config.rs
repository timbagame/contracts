use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeConfig>,
    treasury: Pubkey,
    fee_percentage: u64,
    operator: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.treasury = treasury;
    config.fee_percentage = fee_percentage;
    config.authority = ctx.accounts.authority.key();
    config.operator = operator;

    Ok(())
}
