use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, new_fee_percentage: u8) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.fee_percentage = new_fee_percentage;
    oracle.authority = ctx.accounts.new_authority.key();

    Ok(())
}
