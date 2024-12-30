use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UpdateOracle>,
    fee_percentage: u8,
    oracle_buffer_time: i64,
    max_players: u16,
    max_timeout: i64,
    min_timeout: i64,
) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.fee_percentage = fee_percentage;
    oracle.oracle_buffer_time = oracle_buffer_time;
    oracle.max_players = max_players;
    oracle.max_timeout = max_timeout;
    oracle.min_timeout = min_timeout;
    oracle.authority = ctx.accounts.new_authority.key();

    Ok(())
}
