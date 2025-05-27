use crate::OracleConfig;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        ctx.accounts.new_authority.key(),
    );

    Ok(())
}
