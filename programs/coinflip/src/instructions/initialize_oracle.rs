use crate::{events::OracleInitialized, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let authority_key = ctx.accounts.authority.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        authority_key,
    );

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(OracleInitialized {
        authority: authority_key,
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
