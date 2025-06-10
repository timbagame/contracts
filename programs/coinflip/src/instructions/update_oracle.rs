use crate::{events::OracleUpdated, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state
    // ===============================
    let oracle = &mut ctx.accounts.oracle;
    let old_authority = &ctx.accounts.old_authority;
    let new_authority = &ctx.accounts.new_authority;

    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        new_authority.key(),
    );

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(OracleUpdated {
        old_authority: old_authority.key(),
        new_authority: new_authority.key(),
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
