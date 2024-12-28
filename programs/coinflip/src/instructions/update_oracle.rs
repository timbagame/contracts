use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UpdateOracle>,
    fee_percentage: u8,
    oracle_buffer_time: i64,
) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.fee_percentage = fee_percentage;
    oracle.oracle_buffer_time = oracle_buffer_time;
    oracle.authority = ctx.accounts.new_authority.key();

    Ok(())
}
