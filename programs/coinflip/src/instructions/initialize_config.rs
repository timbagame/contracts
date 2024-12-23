use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeConfig>,
    fee_percentage: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.fee_percentage = fee_percentage;
    config.operator = ctx.accounts.operator.key();
    config.game_counter = 0;

    Ok(())
}
