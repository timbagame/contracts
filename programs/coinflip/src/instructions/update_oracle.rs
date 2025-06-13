use crate::{events::OracleUpdated, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let old_authority_key = ctx.accounts.old_authority.key();
    let new_authority_key = ctx.accounts.new_authority.key();

    // ===============================
    // STATE UPDATES
    // ===============================

    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        new_authority_key,
    );

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(OracleUpdated {
        old_authority: old_authority_key,
        new_authority: new_authority_key,
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
