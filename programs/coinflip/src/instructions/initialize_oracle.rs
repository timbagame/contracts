use crate::{events::OracleInitialized, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeOracle>, config: OracleConfig) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state
    // ===============================
    let oracle = &mut ctx.accounts.oracle;
    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        ctx.accounts.authority.key(),
    );

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(OracleInitialized {
        authority: ctx.accounts.authority.key(),
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
