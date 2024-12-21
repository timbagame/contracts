use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeConfig>,
    treasury: Pubkey,
    fee_percentage: u8,
    operator: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.treasury = treasury;
    config.fee_percentage = fee_percentage;
    config.operator = operator;
    config.game_counter = 0;

    Ok(())
}
