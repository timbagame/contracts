use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateConfig>, new_fee_percentage: u8) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.fee_percentage = new_fee_percentage;
    config.operator = ctx.accounts.new_operator.key();

    Ok(())
}
