use crate::{events::OracleUpdated, OracleConfig};
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

    emit!(OracleUpdated {
        old_authority: ctx.accounts.old_authority.key(),
        new_authority: ctx.accounts.new_authority.key(),
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
